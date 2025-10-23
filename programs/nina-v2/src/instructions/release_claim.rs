use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Token, Transfer},
    token_interface::{
        Token2022,
        Mint,
        TokenAccount,
        TokenInterface,
    },
    token_2022::{MintTo, mint_to},
};

use crate::state::ReleaseV2;
use crate::errors::NinaError;
use crate::utils::id_account_key;
use crate::instructions::release_purchase::{validate_purchase, transfer_crs, mint_release_token};

const ONE_USDC: u64 = 10_000_000;

#[derive(Accounts)]
#[instruction(
  amount: u64,
  release_signer_bump: u8,
)]
pub struct ReleaseClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: can be any account
    pub receiver: UncheckedAccount<'info>,
    #[account(
        seeds = [b"nina-release", mint.key().as_ref()],
        bump,
    )]
    pub release: Account<'info, ReleaseV2>,
    /// CHECK: This is safe because it is derived from release which is checked above
    #[account(
        seeds = [release.key().as_ref()],
        bump,
    )]
    pub release_signer: UncheckedAccount<'info>,
    #[account(
      mut,
      constraint = mint.key() == release.mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
      constraint = payment_mint.key() == release.payment_mint,
    )]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
      mut,
      constraint = payment_token_account.mint == release.payment_mint,
      constraint = payment_token_account.owner == payer.key(),
    )]
    pub payment_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
      mut,
      constraint = royalty_token_account.key() == release.royalty_token_account,
      constraint = royalty_token_account.mint == release.payment_mint,
    )]
    pub royalty_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::token_program = token_program_release_mint,
        associated_token::mint = mint,
        associated_token::authority = receiver,
    )]
    pub receiver_release_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub token_program_release_mint: Interface<'info, TokenInterface>,
}

pub fn handler<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ReleaseClaim<'info>>,
    amount: u64,
    release_signer_bump: u8,
) -> Result<()> {

    if ctx.accounts.release.price != 0 {
        return Err(error!(NinaError::ReleaseClaimNotFree));
    }

    if ctx.accounts.payer.key() != ctx.accounts.receiver.key() {
        #[cfg(feature = "is-test")]
        if ctx.accounts.payer.key() != id_account_key() {
            return Err(error!(NinaError::DelegatedPayerMismatch));
        }
    }

    validate_purchase(&ctx.accounts.release, &ctx.accounts.mint, amount)?;
            
    mint_release_token(
        &ctx.accounts.mint,
        &ctx.accounts.receiver_release_token_account,
        &ctx.accounts.release_signer,
        &ctx.accounts.release,
        &ctx.accounts.token_program_release_mint,
        release_signer_bump,
    )?;
    
    Ok(())
}
