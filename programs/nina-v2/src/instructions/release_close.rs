use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Token, Transfer},
    token_interface::{
        Token2022,
        Mint,
        TokenAccount,
        spl_token_metadata_interface::state::{Field, TokenMetadata}, 
        TokenMetadataUpdateField,
        token_metadata_update_field,
    },
};

use crate::state::ReleaseV2;
use crate::instructions::release_init_v2::update_mint_balance;
use crate::utils::file_service_account_key;
use crate::errors::NinaError;

#[derive(Accounts)]
pub struct ReleaseClose<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        constraint = authority.key() == release.authority,
    )]
    pub authority: Signer<'info>,
    /// CHECK: This is safe because it is derived from release which is checked above
    #[account(
        mut,
        constraint = release_signer.key() == release.release_signer,
    )]
    pub release_signer: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"nina-release", mint.key().as_ref()],
        bump,
    )]
    pub release: Account<'info, ReleaseV2>,
    #[account(
        mut,
        constraint = mint.key() == release.mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handler(
  ctx: Context<ReleaseClose>,
) -> Result<()> {
    if ctx.accounts.payer.key() != ctx.accounts.authority.key() {
        #[cfg(feature = "is-test")]
        if ctx.accounts.payer.key() != file_service_account_key() {
            return Err(error!(NinaError::DelegatedPayerMismatch));
        }
    }

    ctx.accounts.release.total_supply = ctx.accounts.mint.supply;

    Ok(())
}