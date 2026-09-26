import type { AppSettings } from "../../shared/settingsTypes";
import type { PageWorkflowRequest } from "../../shared/pageWorkflowTypes";

export function withTranslationResourceHint(
  request: PageWorkflowRequest,
  settings: AppSettings,
): PageWorkflowRequest {
  return {
    ...request,
    plan: {
      ...request.plan,
      experimentalParallelAcceleration:
        settings.modelProvider === "openai-api" &&
        settings.api.experimentalParallelAcceleration === true,
    },
  };
}
