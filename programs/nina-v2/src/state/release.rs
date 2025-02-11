use anchor_lang::prelude::*;

#[account]
pub struct ReleaseV2 { // 240 bytes
  pub authority: Pubkey, // 32 bytes
  pub release_signer: Pubkey, // 32 bytes
  pub mint: Pubkey, // 32 bytes
  pub royalty_token_account: Pubkey, // 32 bytes
  pub payment_mint: Pubkey, // 32 bytes
  pub total_supply: u64, // 8 bytes
  pub price: u64, // 8 bytes
}
