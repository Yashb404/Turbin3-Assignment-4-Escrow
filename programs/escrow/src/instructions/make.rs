use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface}; //We can use both older and newer
//use anchor_spl::token::Mint older token program
//use anchor_spl::Token_2022::Mint newer token program

use crate::state::Escrow;

#[derive(Accounts)]
pub struct Make<'info>{
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(mint::token_program = token_program)]
    pub mint_a: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program)]
    pub mint_b: InterfaceAccount<'info, Mint>,


    pub token_program: Interface<'info,TokenInterface>
}