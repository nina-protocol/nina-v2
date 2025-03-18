use anchor_lang::{
    prelude::*,
    solana_program::entrypoint::ProgramResult
};
use anchor_spl::{
  associated_token::AssociatedToken,
  token_2022::spl_token_2022::extension::{
      group_member_pointer::GroupMemberPointer,
      metadata_pointer::MetadataPointer,
      mint_close_authority::MintCloseAuthority,
      permanent_delegate::PermanentDelegate,
      transfer_hook::TransferHook,
  },
  token_interface::{
      spl_token_metadata_interface::state::TokenMetadata, 
      token_metadata_initialize,
      Mint,
      Token2022,
      TokenAccount,
      TokenMetadataInitialize,
  },
  token::{
    Token
  }
};
use spl_pod::optional_keys::OptionalNonZeroPubkey;

use crate::{
  get_meta_list_size,
  get_mint_extension_data,
  update_account_lamports_to_minimum_balance,
  META_LIST_ACCOUNT_SEED,
};

use crate::state::ReleaseV2;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ReleaseInitV2Args {
    pub uri: String,
    pub name: String,
    pub symbol: String,
    pub total_supply: u64,
    pub price: u64,
    pub release_signer_bump: u8,
}

#[derive(Accounts)]
#[instruction(uri: String, name: String, symbol: String, total_supply: u64, price: u64, release_signer_bump: u8)]
pub struct ReleaseInitV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
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
    /// CHECK: This is safe because it is derived from release which is checked above
    #[account(
        seeds = [release.key().as_ref()],
        bump,
    )]
    pub release_signer: UncheckedAccount<'info>,
    pub payment_mint: InterfaceAccount<'info, Mint>,
    #[account(
        associated_token::token_program = token_program,
        associated_token::mint = payment_mint,
        associated_token::authority = release_signer,
    )]
    pub royalty_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler (
    ctx: Context<ReleaseInitV2>,
    uri: String,
    name: String,
    symbol: String,
    total_supply: u64,
    price: u64,
    release_signer_bump: u8,
) -> Result <()> {
    let cpi_accounts = TokenMetadataInitialize {
        program_id: ctx.accounts.token_2022_program.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        metadata: ctx.accounts.mint.to_account_info(), // metadata account is the mint, since data is stored in mint
        mint_authority: ctx.accounts.release_signer.to_account_info(),
        update_authority: ctx.accounts.release_signer.to_account_info(),
    };
    let seeds = &[
        ctx.accounts.release.to_account_info().key.as_ref(),
        &[release_signer_bump],
    ];
    
    let signer = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_2022_program.to_account_info(), cpi_accounts, signer);
    token_metadata_initialize(cpi_ctx, name, symbol, uri)?;

    ctx.accounts.mint.reload()?;

    update_account_lamports_to_minimum_balance(
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    )?;

    let release = &mut ctx.accounts.release;
    release.authority = *ctx.accounts.authority.key;
    release.release_signer = *ctx.accounts.release_signer.key;
    release.mint = *ctx.accounts.mint.to_account_info().key;
    release.royalty_token_account = *ctx.accounts.royalty_token_account.to_account_info().key;
    release.payment_mint = *ctx.accounts.payment_mint.to_account_info().key;
    release.total_supply = total_supply;
    release.price = price;

    Ok(())
}
