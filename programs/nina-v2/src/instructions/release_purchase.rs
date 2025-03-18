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
use crate::errors::NinaError;

#[derive(Accounts)]
#[instruction(
  amount: u64,
  release_signer_bump: u8,
)]
pub struct ReleasePurchase<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: can be any account
    #[account(mut)]
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
      constraint = payment_token_account.owner == receiver.key(),
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
        associated_token::token_program = token_2022_program,
        associated_token::mint = mint,
        associated_token::authority = receiver,
    )]
    pub receiver_release_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ReleasePurchase<'info>>,
    amount: u64,
    release_signer_bump: u8,
) -> Result<()> {

    validate_purchase(&ctx, amount)?;
    transfer_payment(&ctx, amount)?;
    mint_release_token(&ctx, release_signer_bump)?;

    Ok(())
}

fn validate_purchase(ctx: &Context<ReleasePurchase>, amount: u64) -> Result<()> {
    if amount != ctx.accounts.release.price {
        return Err(error!(NinaError::ReleasePurchaseWrongAmount));
    }

    if ctx.accounts.mint.supply >= ctx.accounts.release.total_supply {
        return Err(error!(NinaError::ReleasePurchaseSoldOut));
    }

    Ok(())
}

fn transfer_payment(ctx: &Context<ReleasePurchase>, amount: u64) -> Result<()> {
    let cpi_accounts = Transfer {
        from: ctx.accounts.payment_token_account.to_account_info(),
        to: ctx.accounts.royalty_token_account.to_account_info(),
        authority: ctx.accounts.receiver.to_account_info(),
    };
    
    let cpi_ctx_transfer = CpiContext::new(
        ctx.accounts.token_program.to_account_info(), 
        cpi_accounts
    );
    
    anchor_spl::token::transfer(cpi_ctx_transfer, amount)
}

fn mint_release_token(ctx: &Context<ReleasePurchase>, release_signer_bump: u8) -> Result<()> {
    let cpi_accounts_mint_to = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.receiver_release_token_account.to_account_info(),
        authority: ctx.accounts.release_signer.to_account_info(),
    };

    let seeds = &[
        ctx.accounts.release.to_account_info().key.as_ref(),
        &[release_signer_bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_ctx_mint_to = CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.to_account_info(),
        cpi_accounts_mint_to,
        signer
    );
    
    mint_to(cpi_ctx_mint_to, 1)
}
