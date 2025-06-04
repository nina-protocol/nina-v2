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
use crate::utils::file_service_account_key;
use crate::errors::NinaError;

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
        associated_token::authority = authority,
    )]
    pub royalty_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn initialize_token_metadata<'info>(
    token_2022_program: &Program<'info, Token2022>,
    mint: &InterfaceAccount<'info, Mint>,
    release: &Account<'info, ReleaseV2>,
    release_signer: &UncheckedAccount<'info>,
    name: String,
    symbol: String,
    uri: String,
    release_signer_bump: u8,
) -> Result<()> {
    let cpi_accounts = TokenMetadataInitialize {
        program_id: token_2022_program.to_account_info(),
        mint: mint.to_account_info(),
        metadata: mint.to_account_info(),
        mint_authority: release_signer.to_account_info(),
        update_authority: release_signer.to_account_info(),
    };
    
    let seeds = &[
        release.to_account_info().key.as_ref(),
        &[release_signer_bump],
    ];
    
    let signer = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(
        token_2022_program.to_account_info(),
        cpi_accounts,
        signer
    );
    token_metadata_initialize(cpi_ctx, name, symbol, uri)
}

pub fn update_mint_balance<'info>(
    mint: &InterfaceAccount<'info, Mint>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    update_account_lamports_to_minimum_balance(
        mint.to_account_info(),
        payer.to_account_info(),
        system_program.to_account_info(),
    )
}

pub fn set_release_data<'info>(
    release: &mut Account<'info, ReleaseV2>,
    authority: &UncheckedAccount<'info>,
    release_signer: &UncheckedAccount<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    royalty_token_account: &InterfaceAccount<'info, TokenAccount>,
    payment_mint: &InterfaceAccount<'info, Mint>,
    total_supply: u64,
    price: u64,
) {
    release.authority = *authority.key;
    release.release_signer = *release_signer.key;
    release.mint = *mint.to_account_info().key;
    release.royalty_token_account = *royalty_token_account.to_account_info().key;
    release.payment_mint = *payment_mint.to_account_info().key;
    release.total_supply = total_supply;
    release.price = price;
}

pub fn handler(
    ctx: Context<ReleaseInitV2>,
    uri: String,
    name: String,
    symbol: String,
    total_supply: u64,
    price: u64,
    release_signer_bump: u8,
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
    
    Ok(())
}
