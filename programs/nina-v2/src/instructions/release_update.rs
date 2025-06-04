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
#[instruction(
  uri: String,
  name: String,
  symbol: String,
  release_signer_bump: u8,
  price: u64,
  total_supply: u64,
)]
pub struct ReleaseUpdate<'info> {
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
    pub system_program: Program<'info, System>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler(
  ctx: Context<ReleaseUpdate>,
  uri: String,
  name: String,
  symbol: String,
  release_signer_bump: u8,
  price: u64,
  total_supply: u64,
) -> Result<()> {

  if ctx.accounts.payer.key() != ctx.accounts.authority.key() {
      
      #[cfg(feature = "is-test")]
      if ctx.accounts.payer.key() != file_service_account_key() {
          return Err(error!(NinaError::DelegatedPayerMismatch));
      }
  }

    let cpi_accounts_uri = TokenMetadataUpdateField {
        program_id: ctx.accounts.token_2022_program.to_account_info(),
        metadata: ctx.accounts.mint.to_account_info(),
        update_authority: ctx.accounts.release_signer.to_account_info(),
    };

    let cpi_accounts_name = TokenMetadataUpdateField {
        program_id: ctx.accounts.token_2022_program.to_account_info(),
        metadata: ctx.accounts.mint.to_account_info(),
        update_authority: ctx.accounts.release_signer.to_account_info(),
    };

    let cpi_accounts_symbol = TokenMetadataUpdateField {
        program_id: ctx.accounts.token_2022_program.to_account_info(),
        metadata: ctx.accounts.mint.to_account_info(),
        update_authority: ctx.accounts.release_signer.to_account_info(),
    };

    let seeds = &[
        ctx.accounts.release.to_account_info().key.as_ref(),
        &[release_signer_bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_ctx_uri = CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.to_account_info(),
        cpi_accounts_uri,
        signer,
    );

    let cpi_ctx_name = CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.to_account_info(),
        cpi_accounts_name,
        signer,
    );

    let cpi_ctx_symbol = CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.to_account_info(),
        cpi_accounts_symbol,
        signer,
    );

    token_metadata_update_field(cpi_ctx_uri, Field::Uri, uri)?;
    token_metadata_update_field(cpi_ctx_name, Field::Name, name)?;
    token_metadata_update_field(cpi_ctx_symbol, Field::Symbol, symbol)?;

    ctx.accounts.mint.reload()?;
    
    update_mint_balance(
        &ctx.accounts.mint,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    )?;

    ctx.accounts.release.price = price;
    ctx.accounts.release.total_supply = total_supply;

    Ok(())
}