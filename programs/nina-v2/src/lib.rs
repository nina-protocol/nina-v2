use anchor_lang::prelude::*;

declare_id!("BmdryooV1qzhH3auE8xSzxTD97A83i5Xqxw1viRP73rv");
declare_program!(orp);

use crate::orp::types::{
    MerkleContext,
    CompressedProof,
    OrpConfigInputParameter,
    OrpAccountInputParameter,
};

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
        proof: CompressedProof,
        merkle_context: MerkleContext,
        merkle_tree_root_index: u16,
        account_leaf_indexes: Vec<u32>,
        orp_config: OrpConfigInputParameter,
        account_ids: Vec<[u8; 32]>,
        accounts: Vec<OrpAccountInputParameter>,
    ) -> Result<()> {
        instructions::release_purchase::handler(
            ctx,
            amount,
            release_signer_bump,
            proof,
            merkle_context,
            merkle_tree_root_index,
            account_leaf_indexes,
            orp_config,
            account_ids,
            accounts,
        )
    }
}
