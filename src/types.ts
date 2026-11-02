// Subset of the JSON this action reads (only the fields it uses).
// - `xcrun xcresulttool get ...`: written from the JSON Schema printed by `--schema`
//   (schema version 0.5.0, Xcode 27.2). The schemas are saved in schemas/.
// - `xcrun xccov view --report --json`: has no schema; written from its actual output.

/** `xcresulttool get content-availability` */
export interface ContentAvailability {
  hasCoverage: boolean;
  hasDiagnostics: boolean;
  hasTestResults: boolean;
  logs: string[];
}

export type TestResult = "Passed" | "Failed" | "Skipped" | "Expected Failure" | "unknown";

export interface Device {
  deviceId: string;
  deviceName: string;
  architecture: string;
  modelName: string;
  platform?: string;
  osVersion: string;
  osBuildNumber?: string;
}

export interface Issue {
  issueType: string;
  message: string;
  targetName?: string;
  sourceURL?: string;
  className?: string;
}

/** `xcresulttool get test-results summary` */
export interface TestSummary {
  title: string;
  startTime?: number;
  finishTime?: number;
  environmentDescription: string;
  result: TestResult;
  totalTestCount: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  expectedFailures: number;
  devicesAndConfigurations: {
    device: Device;
    testPlanConfiguration: { configurationId: string; configurationName: string };
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    expectedFailures: number;
  }[];
  testFailures: {
    testName: string;
    targetName: string;
    failureText: string;
    testIdentifier: number;
    testIdentifierString: string;
    testIdentifierURL?: string;
  }[];
  runtimeWarnings: Issue[];
}

export type TestNodeType =
  | "Test Plan"
  | "Unit test bundle"
  | "UI test bundle"
  | "Test Suite"
  | "Test Case"
  | "Device"
  | "Test Plan Configuration"
  | "Arguments"
  | "Repetition"
  | "Test Case Run"
  | "Failure Message"
  | "Source Code Reference"
  | "Attachment"
  | "Expression"
  | "Test Value"
  | "Runtime Warning"
  | "Skip Message"
  | "Expected Failure";

export interface TestNode {
  nodeIdentifier?: string;
  nodeIdentifierURL?: string;
  nodeType: TestNodeType;
  name: string;
  details?: string;
  duration?: string;
  durationInSeconds?: number;
  result?: TestResult;
  tags?: string[];
  sourceLocation?: { filePath: string; lineNumber: number };
  children?: TestNode[];
}

/** `xcresulttool get test-results tests` */
export interface Tests {
  devices: Device[];
  testNodes: TestNode[];
}

/** `xcresulttool get build-results` */
export interface BuildResults {
  actionTitle?: string;
  destination: Device;
  startTime: number;
  endTime: number;
  status?: string;
  analyzerWarningCount?: number;
  errorCount?: number;
  warningCount?: number;
  analyzerWarnings: Issue[];
  warnings: Issue[];
  errors: Issue[];
}

export interface CoverageFile {
  name: string;
  path: string;
  coveredLines: number;
  executableLines: number;
  lineCoverage: number;
}

export interface CoverageTarget {
  name: string;
  buildProductPath: string;
  coveredLines: number;
  executableLines: number;
  lineCoverage: number;
  files: CoverageFile[];
}

/** `xccov view --report --json` */
export interface CoverageReport {
  coveredLines: number;
  executableLines: number;
  lineCoverage: number;
  targets: CoverageTarget[];
}
