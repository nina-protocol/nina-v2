export const OrpAccountSchema = {
  struct: {
    owner: { array: { type: "u8", len: 32 } },
    config: { array: { type: "u8", len: 32 } },
    amount_owed: "u64",
  },
};

export const OrpConfigSchema = {
  struct: {
    address: { array: { type: "u8", len: 32 } },
    authority: { array: { type: "u8", len: 32 } },
    pool: { array: { type: "u8", len: 32 } },
    first_minter_percent: "u64",
    invite_referral_percent: "u64",
    purchase_referral_percent: "u64",
    top_supporters_percent: "u64",
    treasury_percent: "u64",
    fee_basis_points: "u64",
    fee_base: "u64",
  },
};
