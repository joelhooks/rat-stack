import { eslintCompatPlugin } from "@oxlint/plugins";

import { noManualEffectErrorTagRule } from "./rules/no-manual-effect-error-tag.ts";
import { noManualTagComparisonRule } from "./rules/no-manual-tag-comparison.ts";
import { noManualTaggedConstructionRule } from "./rules/no-manual-tagged-construction.ts";
import { noManualTaggedTypeRule } from "./rules/no-manual-tagged-type.ts";
import { noOrDieInServiceConstructionRule } from "./rules/no-ordie-in-service-construction.ts";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";
import { noServiceParametersRule } from "./rules/no-service-parameters.ts";
import { preferEffectMatchRule } from "./rules/prefer-effect-match.ts";
import { preferTaggedErrorHandlingRule } from "./rules/prefer-tagged-error-handling.ts";
import { preferYieldServiceRule } from "./rules/prefer-yield-service.ts";
import { requireOperationSpanRule } from "./rules/require-operation-span.ts";

const antiSlopEffectPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop-effect" },
  rules: {
    "no-manual-effect-error-tag": noManualEffectErrorTagRule,
    "no-manual-tag-comparison": noManualTagComparisonRule,
    "no-manual-tagged-construction": noManualTaggedConstructionRule,
    "no-service-constructor-imports": noServiceConstructorImportsRule,
    "prefer-effect-match": preferEffectMatchRule,
    "no-manual-tagged-type": noManualTaggedTypeRule,
    "no-ordie-in-service-construction": noOrDieInServiceConstructionRule,
    "no-service-parameters": noServiceParametersRule,
    "prefer-tagged-error-handling": preferTaggedErrorHandlingRule,
    "prefer-yield-service": preferYieldServiceRule,
    "require-operation-span": requireOperationSpanRule,
  },
});

export default antiSlopEffectPlugin;
