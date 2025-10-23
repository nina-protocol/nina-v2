use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Mint, Token, Burn};
use mpl_token_metadata::{
  self,
  types::{Creator, DataV2},
  instructions::{CreateMetadataAccountV3Cpi, UpdateMetadataAccountV2Cpi, CreateMetadataAccountV3CpiAccounts, UpdateMetadataAccountV2CpiAccounts, CreateMetadataAccountV3InstructionArgs, UpdateMetadataAccountV2InstructionArgs},
};

use crate::state::*;
use crate::utils::file_service_account_key;
use crate::errors::NinaError;

#[derive(Accounts)]
pub struct ReleaseUpdateMetaplex<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: This is safe because we check in the handler that authority === payer 
    /// or that payer is nina operated file-service wallet
    pub authority: UncheckedAccount<'info>,
    #[account(
        seeds = [b"nina-release".as_ref(), release_mint.key().as_ref()],
        constraint = release.authority.key() == authority.key(),
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
      address = release.mint.key(),
      constraint = release_mint.mint_authority == anchor_lang::solana_program::program_option::COption::Some(*release_signer.key),
    )]
    pub release_mint: Box<Account<'info, Mint>>,
    /// CHECK: This is safe because it is initialized here
    #[account(mut)]
    pub metadata: AccountInfo<'info>,
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
    /// CHECK: This is safe because we check against ID
    #[account(address = mpl_token_metadata::ID)]
    pub metadata_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ReleaseMetadataData {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub seller_fee_basis_points: u16,
}

pub fn handler(
    ctx: Context<ReleaseUpdateMetaplex>,
    metadata_data: ReleaseMetadataData,
    release_signer_bump: u8,
) -> Result<()> {
    if ctx.accounts.payer.key() != ctx.accounts.authority.key() {
        if ctx.accounts.payer.key() != file_service_account_key() {
            return Err(NinaError::DelegatedPayerMismatch.into());
        }
    }

    let creators: Vec<Creator> =
    vec![Creator {
        address: *ctx.accounts.release_signer.key,
        verified: true,
        share: 100,
    }];

    let seeds = &[
        ctx.accounts.release.to_account_info().key.as_ref(),
        &[release_signer_bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi = UpdateMetadataAccountV2Cpi::new(
        &ctx.accounts.metadata_program,
        UpdateMetadataAccountV2CpiAccounts {
            metadata: &ctx.accounts.metadata,
            update_authority: &ctx.accounts.release_signer,
        },
        UpdateMetadataAccountV2InstructionArgs {
            data: Some(DataV2 {
                name: metadata_data.name,
                symbol: metadata_data.symbol,
                uri: metadata_data.uri.clone(),
                seller_fee_basis_points: metadata_data.seller_fee_basis_points,
                creators: Some(creators),
                collection: None,
                uses: None
            }),
            is_mutable: Some(true),
            new_update_authority: None,
            primary_sale_happened: None,
        }
    );

    cpi.invoke_signed(
        signer,
    )?;

    Ok(())
}