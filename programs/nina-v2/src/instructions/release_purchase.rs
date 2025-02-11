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

use crate::orp::cpi::deposit;
use crate::orp::cpi::accounts::Deposit;
use crate::orp::types::{
  MerkleContext,
  CompressedProof,
  OrpConfigInputParameter,
  OrpAccountInputParameter,
};
use crate::orp::program::Orp;
use crate::state::ReleaseV2;
use crate::errors::NinaError;

#[derive(Accounts)]
#[instruction(
  amount: u64,
  release_signer_bump: u8,
  proof: CompressedProof,
  merkle_context: MerkleContext,
  merkle_tree_root_index: u16,
  account_leaf_indexes: Vec<u32>,
  orp_config: OrpConfigInputParameter,
  account_ids: Vec<[u8; 32]>,
  accounts: Vec<OrpAccountInputParameter>,
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
    pub orp_program: Program<'info, Orp>,
    /// CHECK: This is checked by the light system program via cpi
    pub orp_cpi_authority_pda: UncheckedAccount<'info>,
    /// CHECK: This is checked by the light system program via cpi
    #[account(mut)]
    pub orp_pool: UncheckedAccount<'info>,
    /// CHECK: This is checked by the light system program via cpi
    #[account(mut)]
    pub treasury_token_account: UncheckedAccount<'info>,
    /// CHECK: This is checked by the light system program via cpi
    pub light_system_program: UncheckedAccount<'info>,
    /// CHECK: This is checked by the light system program via cpi
    pub account_compression_authority: UncheckedAccount<'info>,
    /// CHECK: This is checked by the light system program via cpi
    pub noop_program: UncheckedAccount<'info>,
    /// CHECK: This is checked by the light system program via cpi
    pub account_compression_program: UncheckedAccount<'info>,
    /// CHECK: This is checked by the light system program via cpi
    pub registered_program_pda: AccountInfo<'info>,
}

pub fn handler<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ReleasePurchase<'info>>,
    amount: u64,
    release_signer_bump: u8,
    proof: CompressedProof,
    merkle_context: MerkleContext,
    merkle_tree_root_index: u16,
    account_leaf_indexes: Vec<u32>,
    orp_config: OrpConfigInputParameter,
    account_ids: Vec<[u8; 32]>,
    accounts: Vec<OrpAccountInputParameter>,
) -> Result<()> {
    validate_purchase(&ctx, amount)?;
    transfer_payment(&ctx, amount)?;
    mint_release_token(&ctx, release_signer_bump)?;

    msg!("proof: {:?}", proof);
    msg!("account_leaf_indexes: {:?}", account_leaf_indexes);
    deposit_to_orp(
      &ctx,
      &proof,
      merkle_context,
      merkle_tree_root_index,
      account_leaf_indexes,
      orp_config,
      account_ids,
      accounts,
    )?;
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

fn deposit_to_orp<'c: 'info, 'info>(
  ctx: &Context<'_, '_, 'c, 'info, ReleasePurchase<'info>>,
  proof: &CompressedProof,
  merkle_context: MerkleContext,
  merkle_tree_root_index: u16,
  account_leaf_indexes: Vec<u32>,
  orp_config: OrpConfigInputParameter,
  account_ids: Vec<[u8; 32]>,
  accounts: Vec<OrpAccountInputParameter>,
) -> Result<()> {
    let cpi_accounts = Deposit {
      signer: ctx.accounts.receiver.to_account_info(),
      self_program: ctx.accounts.orp_program.to_account_info(),
      cpi_authority_pda: ctx.accounts.orp_cpi_authority_pda.to_account_info(),
      mint: ctx.accounts.payment_mint.to_account_info(),
      pool: ctx.accounts.orp_pool.to_account_info(),
      depositer_token_account: ctx.accounts.payment_token_account.to_account_info(),
      treasury_token_account: ctx.accounts.treasury_token_account.to_account_info(),
      token_program: ctx.accounts.token_program.to_account_info(),
      light_system_program: ctx.accounts.light_system_program.to_account_info(),
      system_program: ctx.accounts.system_program.to_account_info(),
      account_compression_program: ctx.accounts.account_compression_program.to_account_info(),
      registered_program_pda: ctx.accounts.registered_program_pda.to_account_info(),
      noop_program: ctx.accounts.noop_program.to_account_info(),
      account_compression_authority: ctx.accounts.account_compression_authority.to_account_info(),
    };

    let mut cpi_ctx = CpiContext::new(
        ctx.accounts.orp_program.to_account_info(),
        cpi_accounts,
    );
    cpi_ctx = cpi_ctx.with_remaining_accounts(ctx.remaining_accounts.to_vec());

    const deposit_amount:u64 = 10000000;
    deposit(
      cpi_ctx,
      *proof,
      merkle_context,
      merkle_tree_root_index,
      account_leaf_indexes,
      orp_config,
      account_ids,
      accounts,
      deposit_amount,
    )
}
