// Contract v1.1 samples published by FreeSki (FreeSkiclaude/docs/samples/report-contract-v1/), generated from one real
// cached analysis under freeski-scorecard-7: demonstration_parallel L2, 3 of 7 turns scored. The improvement sample is
// the same clip on the improvement path with current_level "level1", so it is compared with CSIA level 2 examples.
import jobResult from "./fixtures/report-contract-v1/job-result.json";
import improvementJobResult from "./fixtures/report-contract-v1/job-result-improvement.json";
import report from "./fixtures/report-contract-v1/report.json";
import keyframes from "./fixtures/report-contract-v1/keyframes.json";
import explainer from "./fixtures/report-contract-v1/explainer.json";

export const sampleJobResult = jobResult;
export const sampleReport = report;
export const sampleScorecard = jobResult.result.scorecard;
export const sampleTeaching = report.teaching;
export const sampleKeyframes = keyframes;
export const sampleExplainer = explainer;
export const sampleActionId = "certification:level2:demonstration_parallel";
export const sampleImprovementJobResult = improvementJobResult;
export const sampleImprovementActionId = "improvement:level1:parallel";
