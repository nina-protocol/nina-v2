use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Token, Transfer},
    token_interface::{
        Token2022,
        Mint,
        TokenAccount,
    },
    token_2022::{MintTo, mint_to},
};

use crate::state::ReleaseV2;

#[derive(Accounts)]
pub struct ReleaseUpdateMetadata<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
      constraint = authority.key() == release.authority,
    )]
    pub authority: UncheckedAccount<'info>,
    #[account(
      mut,
      constraint = release_signer.key() == release.release_signer,
    )]
    pub release_signer: UncheckedAccount<'info>,
    #[account(
      seeds = [b"nina-release", mint.key.as_ref()],
      bump,
    )]
    pub release: Account<'info, ReleaseV2>,
    #[account(
      mut,
      constraint = mint.key() == release.mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub system_program: Program<'info, System>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<ReleaseUpdateMetadata>) -> Result<()> {
    Ok(())
}