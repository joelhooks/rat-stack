import { Schema } from "effect";

export class ApprovalDenied extends Schema.TaggedError<
  ApprovalDenied,
  { readonly brand: unique symbol }
>()(
  "ApprovalDenied",
  {
    capabilityName: Schema.String,
    reason: Schema.String,
  },
  {
    description: "ApprovalDenied",
    httpApiStatus: 403,
  }
) {
  override get message(): string {
    return `${this.reason}: ${this.capabilityName}`;
  }
}
