import type { CheckRequest } from "./request.js";
import { sameRequest } from "./request.js";
import type { Verdict } from "./verdict.js";

export const appliesToRequest = (active: CheckRequest, verdict: Verdict) =>
  verdict.inputSource === "live-adapter" &&
  verdict.evaluationOnly !== true &&
  verdict.requestContext !== undefined &&
  sameRequest(active, verdict.requestContext) &&
  verdict.observedAt >= active.window.from;

export const bindToRequest = (
  request: CheckRequest,
  sourceRequest: CheckRequest,
  verdict: Verdict
): Verdict => {
  if (
    !sameRequest(request, sourceRequest) ||
    verdict.observedAt < request.window.from
  ) {
    return {
      check: verdict.check,
      control: 0,
      counts: {},
      exitCode: 3,
      observedAt: verdict.observedAt,
      outcome: "not-settled",
      reason: "REQUEST-SCOPE-MISMATCH",
      requestContext: request,
      status: "hold",
    };
  }

  return { ...verdict, inputSource: "live-adapter", requestContext: request };
};
