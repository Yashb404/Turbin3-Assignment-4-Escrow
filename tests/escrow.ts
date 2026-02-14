import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { expect } from "chai";
import { 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction, 
  createMint, 
  mintTo, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

describe("escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;

  const maker = provider.wallet.publicKey;
  const taker = anchor.web3.Keypair.generate();

  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let makerAtaA: anchor.web3.PublicKey;
  let takerAtaB: anchor.web3.PublicKey;
  let makerAtaB: anchor.web3.PublicKey;
  let takerAtaA: anchor.web3.PublicKey;

  const depositAmount = 100;
  const receiveAmount = 200;

  before(async () => {
    await provider.connection.requestAirdrop(maker, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(taker.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));


    mintA = await createMint(provider.connection, (provider.wallet as any).payer, maker, null, 0);
    mintB = await createMint(provider.connection, (provider.wallet as any).payer, taker.publicKey, null, 0);

    makerAtaA = getAssociatedTokenAddressSync(mintA, maker);
    const makerAtaATx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(maker, makerAtaA, maker, mintA)
    );
    await provider.sendAndConfirm(makerAtaATx);
    await mintTo(provider.connection, (provider.wallet as any).payer, mintA, makerAtaA, maker, depositAmount * 2);

    takerAtaB = getAssociatedTokenAddressSync(mintB, taker.publicKey);
    const takerAtaBTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(maker, takerAtaB, taker.publicKey, mintB)
    );
    await provider.sendAndConfirm(takerAtaBTx);
    await mintTo(provider.connection, (provider.wallet as any).payer, mintB, takerAtaB, taker.publicKey, receiveAmount * 2);
  });

  it("Makes and refunds the escrow", async () => {
    const seed1 = new anchor.BN(1111);
    const [escrowPda, escrowBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.toBuffer(), seed1.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const vault = getAssociatedTokenAddressSync(mintA, escrowPda, true);

    await program.methods
      .make(seed1, new anchor.BN(depositAmount), new anchor.BN(receiveAmount))
      .accountsStrict({
        maker: maker,
        mintA: mintA,
        mintB: mintB,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .refund()
      .accountsStrict({
        maker: maker,
        mintA: mintA,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const escrowInfo = await provider.connection.getAccountInfo(escrowPda);
    expect(escrowInfo).to.be.null;
  });

  it("Makes and takes the escrow", async () => {
    const seed2 = new anchor.BN(2222);
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.toBuffer(), seed2.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const vault = getAssociatedTokenAddressSync(mintA, escrowPda, true);

    await program.methods
      .make(seed2, new anchor.BN(depositAmount), new anchor.BN(receiveAmount))
      .accountsStrict({
        maker: maker,
        mintA: mintA,
        mintB: mintB,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    takerAtaA = getAssociatedTokenAddressSync(mintA, taker.publicKey);
    makerAtaB = getAssociatedTokenAddressSync(mintB, maker);

    await program.methods
      .take()
      .accountsStrict({
        taker: taker.publicKey,
        maker: maker,
        mintA: mintA,
        mintB: mintB,
        takerAtaA: takerAtaA,
        takerAtaB: takerAtaB,
        makerAtaB: makerAtaB,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const takerBalanceA = (await provider.connection.getTokenAccountBalance(takerAtaA)).value.uiAmount;
    expect(takerBalanceA).to.equal(depositAmount);
  });
});