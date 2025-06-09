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
use crate::instructions::release_init_v2::{set_release_data, initialize_token_metadata, update_mint_balance};
use crate::instructions::release_purchase::{validate_purchase, transfer_payment, transfer_crs, mint_release_token};
use crate::utils::file_service_account_key;
use crate::errors::NinaError;
#[derive(Accounts)]
#[instruction(
  release_signer_bump: u8,
  uri: String,
  name: String,
  symbol: String,
  total_supply: u64,
  price: u64,
)]
pub struct ReleaseInitAndPurchase<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: can be any account
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: can be any account
    pub authority: UncheckedAccount<'info>,
    #[account(
        init,
        seeds = [b"nina-release", mint.key.as_ref()],
        bump,
        payer = payer,
        space = 232,
    )]
    pub release: Account<'info, ReleaseV2>,
    /// CHECK: This is safe because it is derived from release which is checked above
    #[account(
        seeds = [release.key().as_ref()],
        bump,
    )]
    pub release_signer: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        mint::token_program = token_2022_program,
        mint::decimals = 0,
        mint::authority = release_signer,
        extensions::metadata_pointer::authority = release_signer,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
      mut,
      constraint = payment_token_account.mint == payment_mint.key(),
      constraint = payment_token_account.owner == receiver.key(),
    )]
    pub payment_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
      mut,
      associated_token::token_program = token_program,
      associated_token::mint = payment_mint,
      associated_token::authority = authority,
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
    //   constraint = crs_token_account.mint == payment_mint.key(),
    // )]
    // pub crs_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler(
    ctx: Context<ReleaseInitAndPurchase>,
    release_signer_bump: u8,
    uri: String,
    name: String,
    symbol: String,
    total_supply: u64,
    price: u64,
) -> Result<()> {

    if ctx.accounts.payer.key() != ctx.accounts.authority.key() {
        #[cfg(feature = "is-test")]
        if ctx.accounts.payer.key() != file_service_account_key() {
            return Err(error!(NinaError::DelegatedPayerMismatch));
        }
    }

    initialize_token_metadata(
        &ctx.accounts.token_2022_program,
        &ctx.accounts.mint,
        &ctx.accounts.release,
        &ctx.accounts.release_signer,
        name,
        symbol,
        uri,
        release_signer_bump,
    )?;

    ctx.accounts.mint.reload()?;

    update_mint_balance(
        &ctx.accounts.mint,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    )?;

    set_release_data(
        &mut ctx.accounts.release,
        &ctx.accounts.authority,
        &ctx.accounts.release_signer,
        &ctx.accounts.mint,
        &ctx.accounts.royalty_token_account,
        &ctx.accounts.payment_mint,
        total_supply,
        price,
    );

    validate_purchase(
        &ctx.accounts.release,
        &ctx.accounts.mint,
        price,
    )?;

    transfer_payment(
        &ctx.accounts.payment_token_account,
        &ctx.accounts.royalty_token_account,
        &ctx.accounts.receiver,
        &ctx.accounts.token_program,
        price,
    )?;

    // transfer_crs(
    //     &ctx.accounts.payment_token_account,
    //     &ctx.accounts.crs_token_account,
    //     &ctx.accounts.receiver,
    //     &ctx.accounts.token_program,
    //     price,
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
    