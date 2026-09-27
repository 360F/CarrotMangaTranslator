import type { AppSettings } from "../../shared/settingsTypes";
import type { PageWorkflowRequest } from "../../shared/pageWorkflowTypes";
import { experimentalParallelAccelerationIssue } from "../../shared/pageWorkflowPolicy";

export function withTranslationResourceHint(
  request: PageWorkflowRequest,
  settings: AppSettings,
): PageWorkflowRequest {
  const plan = { ...request.plan, experimentalParallelAcceleration: true };
  return {
    ...request,
    plan: {
      ...request.plan,
      // The setting is a preference: a run whose stages cannot overlap runs
      // serially instead of failing preflight, and the setting stays on.
      experimentalParallelAcceleration:
        settings.modelProvider === "openai-api" &&
        settings.api.experimentalParallelAcceleration === true &&
        experimentalParallelAccelerationIssue(plan) === undefined,
    },
  };
}
