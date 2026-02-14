import { assert } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction, 
  createMint, 
  mintTo, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

describe("escrow make and then refund", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;
  const maker = (provider.wallet as any).payer;
  const taker = anchor.web3.Keypair.generate();
  const seed = new anchor.BN(1);
  
  let escrowPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let makerAtaA: anchor.web3.PublicKey;
  let takerAtaB: anchor.web3.PublicKey;
  let makerAtaB: anchor.web3.PublicKey;
  let takerAtaA: anchor.web3.PublicKey;

  const depositAmount = 100;
  const receiveAmount = 200;

  before(async () => {
    console.log("Airdropping SOL to maker & taker...");
    const latestBlockHash = await provider.connection.getLatestBlockhash();

    const sig1 = await provider.connection.requestAirdrop(
      maker.publicKey, 
      100 * anchor.web3.LAMPORTS_PER_SOL
    );
    const sig2 = await provider.connection.requestAirdrop(
      taker.publicKey, 
      100 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await Promise.all([
      provider.connection.confirmTransaction({
        signature: sig1,
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      }),
      provider.connection.confirmTransaction({
        signature: sig2,
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      }),
    ]);

    console.log("Creating mints...");
    mintA = await createMint(provider.connection, maker, maker.publicKey, null, 0);
    mintB = await createMint(provider.connection, taker, taker.publicKey, null, 0);
    console.log("Mints created:", mintA.toBase58(), mintB.toBase58());

    console.log("Creating ATAs...");
    makerAtaA = getAssociatedTokenAddressSync(mintA, maker.publicKey);
    takerAtaB = getAssociatedTokenAddressSync(mintB, taker.publicKey);
    takerAtaA = getAssociatedTokenAddressSync(mintA, taker.publicKey);
    makerAtaB = getAssociatedTokenAddressSync(mintB, maker.publicKey);
    
    const makerAtaAIx = createAssociatedTokenAccountInstruction(
      maker.publicKey, makerAtaA, maker.publicKey, mintA
    );
    const takerAtaBIx = createAssociatedTokenAccountInstruction(
      taker.publicKey, takerAtaB, taker.publicKey, mintB
    );
    const takerAtaAIx = createAssociatedTokenAccountInstruction(
      taker.publicKey, takerAtaA, taker.publicKey, mintA
    );
    const makerAtaBIx = createAssociatedTokenAccountInstruction(
      maker.publicKey, makerAtaB, maker.publicKey, mintB
    );

    const tx = new anchor.web3.Transaction().add(
      makerAtaAIx, takerAtaBIx, makerAtaBIx, takerAtaAIx
    );
    await provider.sendAndConfirm(tx, [maker, taker]);
    console.log("ATAs created:", makerAtaA.toBase58(), takerAtaB.toBase58());

    console.log("Minting tokens...");
    const mintATx = await mintTo(
      provider.connection, maker, mintA, makerAtaA, maker, depositAmount
    );
    const mintBTx = await mintTo(
      provider.connection, taker, mintB, takerAtaB, taker, receiveAmount
    );
    console.log("Tokens minted:", mintATx, mintBTx);

    console.log("Checking initial balances...");
    const makerTokenBalanceA = await provider.connection.getTokenAccountBalance(makerAtaA);
    const takerTokenBalanceB = await provider.connection.getTokenAccountBalance(takerAtaB);
    const makerTokenBalanceB = await provider.connection.getTokenAccountBalance(makerAtaB);
    const takerTokenBalanceA = await provider.connection.getTokenAccountBalance(takerAtaA);

    console.log("Maker token balance A:", makerTokenBalanceA.value.amount);
    console.log("Maker token balance B:", makerTokenBalanceB.value.amount);
    console.log("Taker token balance A:", takerTokenBalanceA.value.amount);
    console.log("Taker token balance B:", takerTokenBalanceB.value.amount);

    assert.equal(makerTokenBalanceA.value.amount, String(depositAmount));
    assert.equal(makerTokenBalanceB.value.amount, "0");
    assert.equal(takerTokenBalanceA.value.amount, "0");
    assert.equal(takerTokenBalanceB.value.amount, String(receiveAmount));
  });

  it("Initialize escrow", async () => {
    [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    vaultPda = getAssociatedTokenAddressSync(mintA, escrowPda, true);

    const tx = await program.methods
      .make(seed, new anchor.BN(depositAmount), new anchor.BN(receiveAmount))
      .accountsStrict({
        maker: maker.publicKey,
        mintA: mintA,
        mintB: mintB,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vaultPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Escrow initialized:", tx);

    const makerTokenBalanceA = await provider.connection.getTokenAccountBalance(makerAtaA);
    const makerTokenBalanceB = await provider.connection.getTokenAccountBalance(makerAtaB);
    const vaultTokenBalanceA = await provider.connection.getTokenAccountBalance(vaultPda);
    
    console.log("After make - Maker token balance A:", makerTokenBalanceA.value.amount);
    console.log("After make - Maker token balance B:", makerTokenBalanceB.value.amount);
    console.log("After make - Vault token balance A:", vaultTokenBalanceA.value.amount);
    
    assert.equal(makerTokenBalanceA.value.amount, "0");
    assert.equal(makerTokenBalanceB.value.amount, "0");
    assert.equal(vaultTokenBalanceA.value.amount, String(depositAmount));
  });

  it("Refund escrow", async () => {
    const tx = await program.methods
      .refund()
      .accountsStrict({
        maker: maker.publicKey,
        mintA: mintA,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vaultPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Escrow refunded:", tx);

    const escrowAccountInfo = await provider.connection.getAccountInfo(escrowPda);
    const vaultAccountInfo = await provider.connection.getAccountInfo(vaultPda);
    assert.isNull(escrowAccountInfo, "Escrow account should be closed after refund");
    assert.isNull(vaultAccountInfo, "Vault account should be closed after refund");

    const makerTokenBalanceA = await provider.connection.getTokenAccountBalance(makerAtaA);
    console.log("After refund - Maker token balance A:", makerTokenBalanceA.value.amount);
    assert.equal(makerTokenBalanceA.value.amount, String(depositAmount));
  });
});

describe("escrow make and then take", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;
  const maker = (provider.wallet as any).payer;
  const taker = anchor.web3.Keypair.generate();
  const seed = new anchor.BN(2);
  
  let escrowPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let makerAtaA: anchor.web3.PublicKey;
  let takerAtaB: anchor.web3.PublicKey;
  let makerAtaB: anchor.web3.PublicKey;
  let takerAtaA: anchor.web3.PublicKey;

  const depositAmount = 100;
  const receiveAmount = 200;

  before(async () => {
    console.log("Airdropping SOL to maker & taker...");
    const latestBlockHash = await provider.connection.getLatestBlockhash();

    const sig1 = await provider.connection.requestAirdrop(
      maker.publicKey, 
      100 * anchor.web3.LAMPORTS_PER_SOL
    );
    const sig2 = await provider.connection.requestAirdrop(
      taker.publicKey, 
      100 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await Promise.all([
      provider.connection.confirmTransaction({
        signature: sig1,
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      }),
      provider.connection.confirmTransaction({
        signature: sig2,
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      }),
    ]);

    console.log("Creating mints...");
    mintA = await createMint(provider.connection, maker, maker.publicKey, null, 0);
    mintB = await createMint(provider.connection, taker, taker.publicKey, null, 0);
    console.log("Mints created:", mintA.toBase58(), mintB.toBase58());

    console.log("Creating ATAs...");
    makerAtaA = getAssociatedTokenAddressSync(mintA, maker.publicKey);
    takerAtaB = getAssociatedTokenAddressSync(mintB, taker.publicKey);
    takerAtaA = getAssociatedTokenAddressSync(mintA, taker.publicKey);
    makerAtaB = getAssociatedTokenAddressSync(mintB, maker.publicKey);
    
    const makerAtaAIx = createAssociatedTokenAccountInstruction(
      maker.publicKey, makerAtaA, maker.publicKey, mintA
    );
    const takerAtaBIx = createAssociatedTokenAccountInstruction(
      taker.publicKey, takerAtaB, taker.publicKey, mintB
    );
    const takerAtaAIx = createAssociatedTokenAccountInstruction(
      taker.publicKey, takerAtaA, taker.publicKey, mintA
    );
    const makerAtaBIx = createAssociatedTokenAccountInstruction(
      maker.publicKey, makerAtaB, maker.publicKey, mintB
    );

    const tx = new anchor.web3.Transaction().add(
      makerAtaAIx, takerAtaBIx, makerAtaBIx, takerAtaAIx
    );
    await provider.sendAndConfirm(tx, [maker, taker]);
    console.log("ATAs created:", makerAtaA.toBase58(), takerAtaB.toBase58());

    console.log("Minting tokens...");
    const mintATx = await mintTo(
      provider.connection, maker, mintA, makerAtaA, maker, depositAmount
    );
    const mintBTx = await mintTo(
      provider.connection, taker, mintB, takerAtaB, taker, receiveAmount
    );
    console.log("Tokens minted:", mintATx, mintBTx);

    console.log("Checking initial balances...");
    const makerTokenBalanceA = await provider.connection.getTokenAccountBalance(makerAtaA);
    const takerTokenBalanceB = await provider.connection.getTokenAccountBalance(takerAtaB);
    const makerTokenBalanceB = await provider.connection.getTokenAccountBalance(makerAtaB);
    const takerTokenBalanceA = await provider.connection.getTokenAccountBalance(takerAtaA);

    console.log("Maker token balance A:", makerTokenBalanceA.value.amount);
    console.log("Maker token balance B:", makerTokenBalanceB.value.amount);
    console.log("Taker token balance A:", takerTokenBalanceA.value.amount);
    console.log("Taker token balance B:", takerTokenBalanceB.value.amount);

    assert.equal(makerTokenBalanceA.value.amount, String(depositAmount));
    assert.equal(makerTokenBalanceB.value.amount, "0");
    assert.equal(takerTokenBalanceA.value.amount, "0");
    assert.equal(takerTokenBalanceB.value.amount, String(receiveAmount));
  });

  it("Initialize escrow", async () => {
    [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    vaultPda = getAssociatedTokenAddressSync(mintA, escrowPda, true);

    const tx = await program.methods
      .make(seed, new anchor.BN(depositAmount), new anchor.BN(receiveAmount))
      .accountsStrict({
        maker: maker.publicKey,
        mintA: mintA,
        mintB: mintB,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vaultPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Escrow initialized:", tx);

    const makerTokenBalanceA = await provider.connection.getTokenAccountBalance(makerAtaA);
    const makerTokenBalanceB = await provider.connection.getTokenAccountBalance(makerAtaB);
    const vaultTokenBalanceA = await provider.connection.getTokenAccountBalance(vaultPda);
    
    console.log("After make - Maker token balance A:", makerTokenBalanceA.value.amount);
    console.log("After make - Maker token balance B:", makerTokenBalanceB.value.amount);
    console.log("After make - Vault token balance A:", vaultTokenBalanceA.value.amount);
    
    assert.equal(makerTokenBalanceA.value.amount, "0");
    assert.equal(makerTokenBalanceB.value.amount, "0");
    assert.equal(vaultTokenBalanceA.value.amount, String(depositAmount));
  });

  it("Take escrow", async () => {
    const tx = await program.methods
      .take()
      .accountsStrict({
        taker: taker.publicKey,
        maker: maker.publicKey,
        mintA: mintA,
        mintB: mintB,
        takerAtaA: takerAtaA,
        takerAtaB: takerAtaB,
        makerAtaB: makerAtaB,
        escrow: escrowPda,
        vault: vaultPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([taker])
      .rpc();
    console.log("Escrow taken:", tx);

    const makerTokenBalanceA = await provider.connection.getTokenAccountBalance(makerAtaA);
    const takerTokenBalanceB = await provider.connection.getTokenAccountBalance(takerAtaB);
    const makerTokenBalanceB = await provider.connection.getTokenAccountBalance(makerAtaB);
    const takerTokenBalanceA = await provider.connection.getTokenAccountBalance(takerAtaA);

    console.log("After take - Maker token balance A:", makerTokenBalanceA.value.amount);
    console.log("After take - Maker token balance B:", makerTokenBalanceB.value.amount);
    console.log("After take - Taker token balance A:", takerTokenBalanceA.value.amount);
    console.log("After take - Taker token balance B:", takerTokenBalanceB.value.amount);

    assert.equal(makerTokenBalanceA.value.amount, "0");
    assert.equal(makerTokenBalanceB.value.amount, String(receiveAmount));
    assert.equal(takerTokenBalanceA.value.amount, String(depositAmount));
    assert.equal(takerTokenBalanceB.value.amount, "0");

    const escrowAccountInfo = await provider.connection.getAccountInfo(escrowPda);
    const vaultAccountInfo = await provider.connection.getAccountInfo(vaultPda);
    assert.isNull(escrowAccountInfo, "Escrow account should be closed after take");
    assert.isNull(vaultAccountInfo, "Vault account should be closed after take");
  });
});