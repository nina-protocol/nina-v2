use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use anchor_spl::{
    token::{ Token },
};
use anchor_spl::token_interface::{ Mint, TokenAccount };

use super::*;
use crate::utils::v1_pid;
use crate::state::ReleaseV2;

#[derive(Accounts)]
pub struct ReleaseMigrateMintToV2<'info> {
    #[account(mut)]                 
    pub payer: Signer<'info>,
    /// CHECK: v1 validates
    pub authority: UncheckedAccount<'info>,
    /// CHECK: v1 validates (AccountLoader in v1; RO here is fine)
    pub release: UncheckedAccount<'info>,
    #[account(mut)]                 
    pub release_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: v1 validates
    pub release_signer: UncheckedAccount<'info>,
    /// CHECK: v1 validates
    pub v2_release_signer: UncheckedAccount<'info>,
    /// CHECK: v1 validates
    pub v2_release: Account<'info, ReleaseV2>,
    /// CHECK: v1 validates
    #[account(mut)]                 
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: v1 validates
    pub metadata_program: UncheckedAccount<'info>,
    /// CHECK: v1 validates
    pub token_program: Program<'info, Token>,
    /// CHECK: v1 validates
    pub system_program: Program<'info, System>,
    /// CHECK: v1 validates
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: v1 validates
    #[account(address = anchor_lang::solana_program::sysvar::instructions::id())]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ReleaseMigrate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: validated in v1
    pub authority: UncheckedAccount<'info>,

    // v1 has AccountLoader<Release> with `mut` + `close = payer`
    // RO/Mut here only matters for CPI metas; keep it mut.
    /// CHECK: validated in v1
    #[account(mut)]
    pub release: UncheckedAccount<'info>,

    /// CHECK: validated in v1
    pub release_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: validated & used as PDA in v1
    pub release_signer: UncheckedAccount<'info>,

    /// CHECK: validated in v1
    pub payment_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: validated in v1
    #[account(mut)]
    pub royalty_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: validated in v1
    pub token_program: Program<'info, Token>,
    /// CHECK: validated in v1
    pub system_program: Program<'info, System>,
}


pub mod cpi {
    use super::*;

    pub fn release_migrate_mint_to_v2<'info>(
        ctx: CpiContext<'_, '_, '_, 'info, ReleaseMigrateMintToV2<'info>>,
    ) -> Result<()> {
        // Discriminator-only, no args in v1
        let mut data = [0u8; 8];
        data.copy_from_slice(&anchor_lang::solana_program::hash::hash(b"global:release_migrate_mint_to_v2").to_bytes()[..8]);

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: v1_pid(),
            accounts: ctx.to_account_metas(None),
            data: data.to_vec(),
        };
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &ctx.to_account_infos(),
            ctx.signer_seeds,
        )?;
        Ok(())
    }

    pub fn release_migrate<'info>(
        mut cpi_ctx: CpiContext<'_, '_, '_, 'info, ReleaseMigrate<'info>>,
    ) -> Result<()> {
        let disc = &anchor_lang::solana_program::hash::hash(b"global:release_migrate").to_bytes()[..8];
    
        // fixed metas
        let mut metas = cpi_ctx.accounts.to_account_metas(None);
        // append remaining metas (writable)
        metas.extend(
            cpi_ctx
                .remaining_accounts
                .iter()
                .map(|ai| anchor_lang::solana_program::instruction::AccountMeta::new(ai.key(), false)),
        );
    
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: v1_pid(), // your v1 program id from declare_id!
            accounts: metas,
            data: disc.to_vec(),
        };
    
        // IMPORTANT: start from the full CPI context (includes the program account)
        let mut infos = cpi_ctx.to_account_infos();
        // and still include remaining accounts
        infos.extend_from_slice(&cpi_ctx.remaining_accounts);
    
        if !cpi_ctx.signer_seeds.is_empty() {
            anchor_lang::solana_program::program::invoke_signed(
                &ix,
                &infos,
                cpi_ctx.signer_seeds,
            )?;
        } else {
            anchor_lang::solana_program::program::invoke(&ix, &infos)?;
        }
        Ok(())
    }
}