use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;

pub use state::*;
pub use instructions::*;

declare_id!("AQofGUSSKDkaayxW3iC48DaBCzcZVzGRT7jJ9C7vG3Rs");

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
        ctx.accounts.take_and_close_vault()?;
        Ok(())
    }
}