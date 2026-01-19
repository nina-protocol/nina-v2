use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke, hash::hash, sysvar::{self}};
use anchor_lang::prelude::borsh::{self, BorshSerialize, BorshDeserialize};
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{ Token, Transfer },
};
use anchor_spl::token_interface::{ Mint, TokenAccount };
use std::str::FromStr;

use crate::state::{ReleaseV1, ReleaseV2};
use crate::instructions::release_init_v2::set_release_data;
use crate::errors::NinaError;
use crate::v1;
use crate::utils::v1_pid;

pub fn metadata_program_id() -> Pubkey {
  Pubkey::from_str("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").unwrap()
}

pub fn payer_account_id() -> Pubkey {
  Pubkey::from_str("ninAhDNqCPxwAza2ZYVgjQDTC1cgF1PWaydibbfqhcn").unwrap()
}

#[derive(Accounts)]
pub struct ReleaseMigrateV1ToV2<'info> {
    #[account(
      mut,
      address = payer_account_id(),
    )]
    pub payer: Signer<'info>,
    /// CHECK: This is safe bc checked in cpi
    pub authority: UncheckedAccount<'info>,
    /// CHECK: This is safe bc checked in cpi
    #[account(mut)]
    pub release: UncheckedAccount<'info>,
    #[account(mut)]
    pub release_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: This is safe bc checked in cpi
    pub release_signer: UncheckedAccount<'info>,
    pub payment_mint: InterfaceAccount<'info, Mint>,
    pub v1_payment_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub royalty_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
      init,
      seeds = [b"nina-release", release_mint.key().as_ref()],
      bump,
      payer = payer,
      space = 232,
    )]
    pub v2_release: Account<'info, ReleaseV2>,
    /// CHECK: This is safe because it is derived from release which is checked above
    #[account(
        seeds = [v2_release.key().as_ref()],
        bump,
    )]  
    pub v2_release_signer: UncheckedAccount<'info>,  
    #[account(
      init_if_needed,
      payer = payer,
      associated_token::token_program = token_program,
      associated_token::mint = payment_mint,
      associated_token::authority = authority,
    )]
    pub v2_authority_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: This is safe bc checked in cpi
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: This is safe bc checked in cpi
    pub metadata_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: This is safe bc checked in cpi
    #[account(address = sysvar::instructions::id())]
    pub sysvar_instructions: UncheckedAccount<'info>,
    /// CHECK: v1 program id
    #[account(address = v1_pid())]
    pub v1_program: UncheckedAccount<'info>,    
}

pub fn handler<'c: 'info, 'info>(
  ctx: Context<'_, '_, 'c, 'info, ReleaseMigrateV1ToV2<'info>>,
) -> Result<()> {
  msg!("release_migrate_mint_to_v2 cpi");
  release_migrate_mint_to_v2_handler(&ctx)?; // ok

  // ---- read from v1 Release without holding the Ref across the CPI ----
  let (total_supply, price) = {
      let data_ref = ctx.accounts.release.try_borrow_data()?;
      read_release_v1_supply_and_price(&data_ref)?
  }; // <— data_ref dropped here

  msg!("setting release data");
  set_release_data(
      &mut ctx.accounts.v2_release,
      &ctx.accounts.authority,
      &ctx.accounts.v2_release_signer,
      &ctx.accounts.release_mint,
      &ctx.accounts.v2_authority_token_account,
      &ctx.accounts.payment_mint,
      total_supply,
      price,
  );

  msg!("release_migrate cpi");
  release_migrate_handler(&ctx)?; // now v1 can load_mut() release
  msg!("release_migrate completed");
  Ok(())
}

fn read_release_v1_supply_and_price(data: &[u8]) -> Result<(u64, u64)> {
  // 1) sanity: check discriminator for "Release"
  let disc = hash(b"account:Release").to_bytes();
  if &data[..8] != &disc[..8] {
    return Err(error!(NinaError::InvalidAccountData));
  }

  // 2) body after discriminator
  let body = &data[8..];

  // 3) read totals (little-endian)
  let total_supply = u64::from_le_bytes(body[232..240].try_into().unwrap());
  let price        = u64::from_le_bytes(body[248..256].try_into().unwrap());

  Ok((total_supply, price))
}

pub fn release_migrate_mint_to_v2_handler<'c: 'info, 'info>(
    ctx: &Context<'_, '_, 'c, 'info, ReleaseMigrateV1ToV2<'info>>,
) -> Result<()> {
    let cpi_accounts = v1::ReleaseMigrateMintToV2 {
      payer:                ctx.accounts.payer.clone(),
      authority:            ctx.accounts.authority.clone(),
      release:              ctx.accounts.release.clone(),
      release_mint:         ctx.accounts.release_mint.clone(),
      release_signer:       ctx.accounts.release_signer.clone(),
      v2_release_signer:    ctx.accounts.v2_release_signer.clone(),
      v2_release:           ctx.accounts.v2_release.clone(),
      metadata:             ctx.accounts.metadata.clone(),
      metadata_program:     ctx.accounts.metadata_program.clone(),
      token_program:        ctx.accounts.token_program.clone(),
      system_program:       ctx.accounts.system_program.clone(),
      rent:                 ctx.accounts.rent.clone(),
      sysvar_instructions:  ctx.accounts.sysvar_instructions.clone(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.v1_program.to_account_info(), cpi_accounts);
    v1::cpi::release_migrate_mint_to_v2(cpi_ctx);

    Ok(())
}

pub fn release_migrate_handler<'c: 'info, 'info>(
    ctx: &Context<'_, '_, 'c, 'info, ReleaseMigrateV1ToV2<'info>>,
) -> Result<()> {
    // Build the CPI accounts struct
    let cpi_accounts = v1::ReleaseMigrate {
        payer:               ctx.accounts.payer.clone(),
        authority:           ctx.accounts.authority.clone(),
        release:             ctx.accounts.release.clone(),
        release_mint:        ctx.accounts.release_mint.clone(),
        release_signer:      ctx.accounts.release_signer.clone(),
        payment_mint:        ctx.accounts.v1_payment_mint.clone(),
        royalty_token_account: ctx.accounts.royalty_token_account.clone(),
        token_program:       ctx.accounts.token_program.clone(),
        system_program:      ctx.accounts.system_program.clone(),
    };

    let mut cpi_ctx = CpiContext::new(
        // The v1 program ID isn’t needed here because the shim constructs the ix,
        // but the API wants a Program AI; the value isn’t used in the shim.
        ctx.accounts.system_program.to_account_info(), // any RO AI; not used
        cpi_accounts,
    );

    // append all royalty recipient token accounts (destinations) as remaining accounts
    cpi_ctx = cpi_ctx.with_remaining_accounts(ctx.remaining_accounts.to_vec());

    // do the CPI
    v1::cpi::release_migrate(cpi_ctx)?;

    Ok(())
}