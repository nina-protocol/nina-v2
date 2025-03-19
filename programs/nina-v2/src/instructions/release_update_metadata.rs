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

#[derive(Accounts)]
#[instruction(
  uri: String,
  release_signer_bump: u8,
)]
pub struct ReleaseUpdateMetadata<'info> {
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
  ctx: Context<ReleaseUpdateMetadata>,
  uri: String,
  release_signer_bump: u8,
) -> Result<()> {
    let cpi_accounts = TokenMetadataUpdateField {
        program_id: ctx.accounts.token_2022_program.to_account_info(),
        metadata: ctx.accounts.mint.to_account_info(),
        update_authority: ctx.accounts.release_signer.to_account_info(),
    };

    let seeds = &[
        ctx.accounts.release.to_account_info().key.as_ref(),
        &[release_signer_bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.to_account_info(),
        cpi_accounts,
        signer,
    );

    let field = Field::Uri;
    token_metadata_update_field(cpi_ctx, field, uri)?;

    Ok(())
}