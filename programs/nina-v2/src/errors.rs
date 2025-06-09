use anchor_lang::prelude::*;

#[error_code]
pub enum NinaError {
    #[msg("Release Purchase wrong receiver")]
    ReleasePurchaseWrongReceiver,
    #[msg("Release Purchase wrong amount")]
    ReleasePurchaseWrongAmount,
    #[msg("Release Purchase sold out")]
    ReleasePurchaseSoldOut,
    #[msg("Arithmetic error")]
    ArithmeticError,
    #[msg("Delegated Payer Mismatch")]
    DelegatedPayerMismatch,
}