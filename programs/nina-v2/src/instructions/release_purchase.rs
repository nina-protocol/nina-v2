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
use crate::utils::id_account_key;

const BASIS_POINTS: u64 = 1_000_000;
const ONE_USDC: u64 = 10_000_000;
const TEN_PERCENT: u64 = 100_000;

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
    pub receiver: Signer<'info>,
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
    ///TODO: CHECK THAT ADDRESS === EXPECTED CRS ADDRESS
    // #[account(
    //   mut,
    //   constraint = crs_token_account.mint == release.payment_mint,
    // )]
    // pub crs_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
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
    if ctx.accounts.payer.key() != ctx.accounts.receiver.key() {
        #[cfg(feature = "is-test")]
        if ctx.accounts.payer.key() != id_account_key() {
            return Err(error!(NinaError::DelegatedPayerMismatch));
        }
    }

    validate_purchase(&ctx.accounts.release, &ctx.accounts.mint, amount)?;
    
    transfer_payment(
        &ctx.accounts.payment_token_account,
        &ctx.accounts.royalty_token_account,
        &ctx.accounts.receiver,
        &ctx.accounts.token_program,
        amount,
    )?;
    
    // transfer_crs(
    //     &ctx.accounts.payment_token_account,
    //     &ctx.accounts.crs_token_account,
    //     &ctx.accounts.receiver,
    //     &ctx.accounts.token_program,
    //     amount,
    // )?;
    
    mint_release_token(
        &ctx.accounts.mint,
        &ctx.accounts.receiver_release_token_account,
        &ctx.accounts.release_signer,
        &ctx.accounts.release,
        &ctx.accounts.token_2022_program,
        release_signer_bump,
    )?;
    
    Ok(())
}

pub fn validate_purchase<'info>(
    release: &Account<'info, ReleaseV2>,
    mint: &InterfaceAccount<'info, Mint>,
    amount: u64,
) -> Result<()> {
    if amount != release.price {
        return Err(error!(NinaError::ReleasePurchaseWrongAmount));
    }

    if mint.supply >= release.total_supply {
        return Err(error!(NinaError::ReleasePurchaseSoldOut));
    }

    Ok(())
}

pub fn transfer_payment<'info>(
    payment_token_account: &InterfaceAccount<'info, TokenAccount>,
    royalty_token_account: &InterfaceAccount<'info, TokenAccount>,
    payer: &Signer<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: payment_token_account.to_account_info(),
        to: royalty_token_account.to_account_info(),
        authority: payer.to_account_info(),
    };
    
    let cpi_ctx_transfer = CpiContext::new(
        token_program.to_account_info(), 
        cpi_accounts
    );
    
    anchor_spl::token::transfer(cpi_ctx_transfer, amount)
}

pub fn mint_release_token<'info>(
    mint: &InterfaceAccount<'info, Mint>,
    receiver_release_token_account: &InterfaceAccount<'info, TokenAccount>,
    release_signer: &UncheckedAccount<'info>,
    release: &Account<'info, ReleaseV2>,
    token_2022_program: &Program<'info, Token2022>,
    release_signer_bump: u8,
) -> Result<()> {
    let cpi_accounts_mint_to = MintTo {
        mint: mint.to_account_info(),
        to: receiver_release_token_account.to_account_info(),
        authority: release_signer.to_account_info(),
    };

    let seeds = &[
        release.to_account_info().key.as_ref(),
        &[release_signer_bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_ctx_mint_to = CpiContext::new_with_signer(
        token_2022_program.to_account_info(),
        cpi_accounts_mint_to,
        signer
    );
    
    mint_to(cpi_ctx_mint_to, 1)
}

pub fn transfer_crs<'info>(
    payment_token_account: &InterfaceAccount<'info, TokenAccount>,
    crs_token_account: &InterfaceAccount<'info, TokenAccount>,
    receiver: &UncheckedAccount<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let mut crs_amount = ONE_USDC;
    if amount > ONE_USDC {
        crs_amount = amount
            .checked_mul(TEN_PERCENT)
            .ok_or(NinaError::ArithmeticError)?
            .checked_div(BASIS_POINTS)
            .ok_or(NinaError::ArithmeticError)?
    }

    let cpi_accounts = Transfer {
        from: payment_token_account.to_account_info(),
        to: crs_token_account.to_account_info(),
        authority: receiver.to_account_info(),
    };

    let cpi_ctx_transfer = CpiContext::new(
        token_program.to_account_info(), 
        cpi_accounts
    );
    
    anchor_spl::token::transfer(cpi_ctx_transfer, crs_amount)
}