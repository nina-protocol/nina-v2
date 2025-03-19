use anchor_lang::prelude::*;

declare_id!("BmdryooV1qzhH3auE8xSzxTD97A83i5Xqxw1viRP73rv");

pub mod state;
pub mod instructions;
pub mod utils;
pub mod errors;

pub use state::*;
pub use instructions::*;
pub use utils::*;
pub use errors::*;
  
#[program]
pub mod nina_v2 {
    use super::*;

    pub fn release_init_v2(
        ctx: Context<ReleaseInitV2>,
        uri: String,
        name: String,
        symbol: String,
        total_supply:u64,
        price: u64,
        release_signer_bump: u8,
    ) -> Result<()> {
        instructions::release_init_v2::handler(ctx, uri, name, symbol, total_supply, price, release_signer_bump)
    }

    pub fn release_purchase<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ReleasePurchase<'info>>,
        amount: u64,
        release_signer_bump: u8,
    ) -> Result<()> {
        instructions::release_purchase::handler(
            ctx,
            amount,
            release_signer_bump,
        )
    }

    pub fn release_init_and_purchase<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ReleaseInitAndPurchase<'info>>,
        release_signer_bump: u8,
        uri: String,
        name: String,
        symbol: String,
        total_supply: u64,
        price: u64,
    ) -> Result<()> {
        instructions::release_init_and_purchase::handler(
            ctx,
            release_signer_bump,
            uri,
            name,
            symbol,
            total_supply,
            price,
        )
    }

    pub fn release_update_metadata<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ReleaseUpdateMetadata<'info>>,
        uri: String,
        name: String,
        symbol: String,
        release_signer_bump: u8,
    ) -> Result<()> {
        instructions::release_update_metadata::handler(ctx, uri, name, symbol, release_signer_bump)
    }
}
