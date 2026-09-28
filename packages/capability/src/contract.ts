import { Data, Schema } from "effect";
import type { Effect } from "effect";

import { ApprovalDenied } from "./approval-denied.js";
import type { Approval } from "./approval.js";

export interface Annotations {
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly idempotent: boolean;
  readonly openWorld: boolean;
}

export type PlainSchema = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export type InputSchema = Schema.Struct<Record<string, PlainSchema>>;

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface HttpRoute {
  readonly method: HttpMethod;
  readonly path: `/${string}`;
}

type SegmentParam<Segment extends string> = Segment extends `:${infer Name}`
  ? Name
  : never;

export type PathParamNames<Path extends string> =
  Path extends `${infer Segment}/${infer Rest}`
    ? SegmentParam<Segment> | PathParamNames<Rest>
    : SegmentParam<Path>;

type StrayParams<Http extends HttpRoute, Input extends InputSchema> = Exclude<
  PathParamNames<Http["path"]>,
  keyof Input["fields"]
>;

export type RouteParamsCheck<
  Http,
  Input extends InputSchema,
> = Http extends HttpRoute
  ? [StrayParams<Http, Input>] extends [never]
    ? unknown
    : Readonly<
        Record<
          `path parameter :${StrayParams<Http, Input> & string} is not an input field`,
          never
        >
      >
  : unknown;

export type ApprovalRequirement<NeedsApproval extends boolean> =
  NeedsApproval extends false ? never : Approval;

export type FailureSchemaOf<
  Failure extends PlainSchema,
  NeedsApproval extends boolean,
> = NeedsApproval extends false
  ? Failure
  : Schema.Union<readonly [Failure, typeof ApprovalDenied]>;

export interface Contract<
  Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  NeedsApproval extends boolean = false,
  Http extends HttpRoute | undefined = undefined,
> {
  readonly _tag: "Contract";
  readonly name: Name;
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  readonly failure: Failure;
  readonly annotations: Annotations;
  readonly needsApproval: NeedsApproval;
  readonly http: Http;
}

export type AnyContract = Contract<
  string,
  InputSchema,
  PlainSchema,
  PlainSchema,
  boolean,
  HttpRoute | undefined
>;

export interface Capability<
  ContractType extends AnyContract,
  Requirements = never,
> {
  readonly _tag: "Capability";
  readonly contract: ContractType;
  readonly handler: (
    input: ContractType["input"]["Type"]
  ) => Effect.Effect<
    ContractType["output"]["Type"],
    FailureOf<ContractType>["Type"],
    Requirements | ApprovalRequirement<ContractType["needsApproval"]>
  >;
}

export interface AnyCapability {
  readonly _tag: "Capability";
  readonly contract: AnyContract;
  readonly handler: (input: never) => Effect.Effect<unknown, unknown, unknown>;
}

export type ContractOf<Value> = Value extends {
  readonly contract: infer ContractType;
}
  ? ContractType
  : Value extends { readonly _tag: "Contract" }
    ? Value
    : never;

export type NameOf<Value> =
  ContractOf<Value> extends {
    readonly name: infer Name extends string;
  }
    ? Name
    : never;

export type InputOf<Value> =
  ContractOf<Value> extends {
    readonly input: infer Input extends InputSchema;
  }
    ? Input
    : never;

export type OutputOf<Value> =
  ContractOf<Value> extends {
    readonly output: infer Output extends PlainSchema;
  }
    ? Output
    : never;

export type HttpRouteOf<Value> =
  ContractOf<Value> extends {
    readonly http: infer Route extends HttpRoute;
  }
    ? Route
    : undefined;

export type ContractFailureOf<Value> =
  ContractOf<Value> extends {
    readonly failure: infer Failure extends PlainSchema;
  }
    ? Failure
    : never;

export type FailureOf<Value> =
  ContractOf<Value> extends {
    readonly failure: infer Failure extends PlainSchema;
    readonly needsApproval: infer NeedsApproval extends boolean;
  }
    ? FailureSchemaOf<Failure, NeedsApproval>
    : never;

export type RequirementsOf<Value> = Value extends readonly AnyCapability[]
  ? CapabilityRequirementsOf<Value[number]>
  : CapabilityRequirementsOf<Value>;

type CapabilityRequirementsOf<Value> =
  Value extends Capability<infer ContractType, infer Requirements>
    ? Requirements | ApprovalRequirement<ContractType["needsApproval"]>
    : never;

export interface DefineContractOptions<
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  NeedsApproval extends boolean = false,
  Http extends HttpRoute | undefined = undefined,
> {
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  readonly failure: Failure;
  readonly annotations?: Partial<Annotations> | undefined;
  readonly needsApproval?: NeedsApproval | undefined;
  readonly http?: Http;
}

const defaultAnnotations: Annotations = {
  destructive: false,
  idempotent: false,
  openWorld: false,
  readOnly: false,
};

class ContractRecord extends Data.TaggedClass("Contract")<
  Omit<AnyContract, "_tag">
> {}

export function defineContract<
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  const Http extends HttpRoute | undefined = undefined,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure, false, Http> &
    RouteParamsCheck<Http, Input>
): Contract<Name, Input, Output, Failure, false, Http>;
export function defineContract<
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  const Http extends HttpRoute | undefined = undefined,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure, true, Http> &
    RouteParamsCheck<Http, Input> & {
      readonly needsApproval: true;
    }
): Contract<Name, Input, Output, Failure, true, Http>;
export function defineContract<
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  const NeedsApproval extends boolean,
  const Http extends HttpRoute | undefined = undefined,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure, NeedsApproval, Http> &
    RouteParamsCheck<Http, Input>
): Contract<Name, Input, Output, Failure, NeedsApproval, Http>;
export function defineContract(
  name: string,
  options: DefineContractOptions<
    InputSchema,
    PlainSchema,
    PlainSchema,
    boolean,
    HttpRoute | undefined
  >
): AnyContract {
  return new ContractRecord({
    annotations: { ...defaultAnnotations, ...options.annotations },
    description: options.description,
    failure: options.failure,
    http: options.http,
    input: options.input,
    name,
    needsApproval: options.needsApproval ?? false,
    output: options.output,
  });
}

export const failureSchemaOf = <
  Failure extends PlainSchema,
  const NeedsApproval extends boolean,
>(contract: {
  readonly failure: Failure;
  readonly needsApproval: NeedsApproval;
}): FailureSchemaOf<Failure, NeedsApproval> => {
  const schema = contract.needsApproval
    ? Schema.Union([contract.failure, ApprovalDenied])
    : contract.failure;

  // SAFETY: the runtime branch preserves the exact schema members represented by the literal `NeedsApproval` type supplied by the contract.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return schema as FailureSchemaOf<Failure, NeedsApproval>;
};
