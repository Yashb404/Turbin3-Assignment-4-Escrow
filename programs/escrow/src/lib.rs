use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;

pub use state::*;
pub use instructions::*;

declare_id!("D7P585ZSpjNfT7tP9i5GR6iPNbHX3BKTgiaxkZ8cfGaU"); 

#[program]
pub mod escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)?;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund_and_close_vault()?;
        Ok(())
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit()?;
        ctx.accounts.withdraw_and_close()?;
        Ok(())
    }
}