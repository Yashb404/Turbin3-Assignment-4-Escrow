use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;



declare_id!("CmuRXmQM8pp3kUUKnDg54ZYQYdh3h6vaJZTvTroZWdd2");

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize(ctx: Context<Make>, seed:u64, deposit: u64, recieve: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, recieve, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
