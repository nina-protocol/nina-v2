use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[account(zero_copy)]
#[repr(packed)]
#[repr(C)]
#[derive(Default)]
pub struct ReleaseV1 {
    pub payer: Pubkey,
    pub authority: Pubkey,
    pub authority_token_account: Pubkey,
    pub release_signer: Pubkey,
    pub release_mint: Pubkey,
    pub release_datetime: i64,
    pub royalty_token_account: Pubkey,
    pub payment_mint: Pubkey,
    pub total_supply: u64,
    pub remaining_supply: u64,
    pub price: u64,
    pub resale_percentage: u64,
    pub total_collected: u64,
    pub sale_counter: u64,
    pub exchange_sale_counter: u64,
    pub sale_total: u64,
    pub exchange_sale_total: u64,
    pub bumps: ReleaseBumps,
    pub head: u64,
    pub tail: u64,
    pub royalty_recipients: [RoyaltyRecipient; 10],
}

#[zero_copy]
#[repr(packed)]
#[repr(C)]
#[derive(Default)]
pub struct RoyaltyRecipient {
    pub recipient_authority: Pubkey,
    pub recipient_token_account: Pubkey,
    pub percent_share: u64,
    pub owed: u64,
    pub collected: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy, Pod, Zeroable)]
#[repr(packed)]
#[repr(C)]
pub struct ReleaseBumps {
    pub release: u8,
    pub signer: u8,
}
