/**
 * 测试报告生成器
 * 将测试结果转换为 Markdown 格式的报告
 */

export interface TestResult {
  id: string;
  testName: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  startTime: number;
  endTime?: number;
  duration?: number;
  error?: string;
  details?: Record<string, any>;
}

export interface TestReport {
  timestamp: string;
  testDomain: string;
  walletAddress: string | undefined;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    averageDuration: number;
  };
}

/**
 * 生成 Markdown 格式的测试报告
 */
export function generateMarkdownReport(report: TestReport): string {
  const { timestamp, testDomain, walletAddress, results, summary } = report;
  
  const successRate = summary.total > 0 
    ? ((summary.passed / summary.total) * 100).toFixed(2)
    : "0.00";

  let markdown = `# 全链路集成测试报告\n\n`;
  markdown += `## 测试概述\n\n`;
  markdown += `**测试日期**: ${new Date(timestamp).toLocaleString()}\n`;
  markdown += `**测试环境**: Base Sepolia Testnet\n`;
  markdown += `**测试域名**: ${testDomain}\n`;
  markdown += `**钱包地址**: ${walletAddress || "未连接"}\n\n`;
  markdown += `---\n\n`;

  markdown += `## 测试结果摘要\n\n`;
  markdown += `| 指标 | 数值 |\n`;
  markdown += `|------|------|\n`;
  markdown += `| 总测试数 | ${summary.total} |\n`;
  markdown += `| 通过 | ${summary.passed} |\n`;
  markdown += `| 失败 | ${summary.failed} |\n`;
  markdown += `| 跳过 | ${summary.skipped} |\n`;
  markdown += `| 平均耗时 | ${summary.averageDuration.toFixed(2)}ms |\n`;
  markdown += `| 成功率 | ${successRate}% |\n\n`;
  markdown += `---\n\n`;

  markdown += `## 详细测试结果\n\n`;

  // 为每个测试生成详细报告
  results.forEach((result, index) => {
    const statusEmoji = result.status === "passed" ? "✅" : result.status === "failed" ? "❌" : "⏳";
    markdown += `### ${index + 1}. ${result.testName}\n\n`;
    markdown += `**测试状态**: ${statusEmoji} ${result.status}\n`;
    markdown += `**耗时**: ${result.duration || 0}ms\n`;
    markdown += `**开始时间**: ${new Date(result.startTime).toLocaleString()}\n`;
    if (result.endTime) {
      markdown += `**结束时间**: ${new Date(result.endTime).toLocaleString()}\n`;
    }
    markdown += `\n`;

    if (result.error) {
      markdown += `#### 错误信息\n\n`;
      markdown += `\`\`\`\n${result.error}\n\`\`\`\n\n`;
    }

    if (result.details) {
      markdown += `#### 详细信息\n\n`;
      markdown += `\`\`\`json\n${JSON.stringify(result.details, null, 2)}\n\`\`\`\n\n`;
    }

    markdown += `---\n\n`;
  });

  // 性能统计
  markdown += `## 性能指标\n\n`;
  
  const passedTests = results.filter((r) => r.status === "passed" && r.duration);
  if (passedTests.length > 0) {
    const durations = passedTests.map((r) => r.duration || 0);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    
    markdown += `### 延迟统计\n\n`;
    markdown += `| 指标 | 数值 |\n`;
    markdown += `|------|------|\n`;
    markdown += `| 平均延迟 | ${avgDuration.toFixed(2)}ms |\n`;
    markdown += `| 最小延迟 | ${minDuration}ms |\n`;
    markdown += `| 最大延迟 | ${maxDuration}ms |\n\n`;
  }

  // 成功率统计
  markdown += `### 成功率统计\n\n`;
  markdown += `| 测试名称 | 状态 | 耗时 |\n`;
  markdown += `|----------|------|------|\n`;
  results.forEach((result) => {
    const statusEmoji = result.status === "passed" ? "✅" : result.status === "failed" ? "❌" : "⏳";
    markdown += `| ${result.testName} | ${statusEmoji} ${result.status} | ${result.duration || 0}ms |\n`;
  });
  markdown += `\n`;

  // 发现的问题
  const failedTests = results.filter((r) => r.status === "failed");
  if (failedTests.length > 0) {
    markdown += `## 发现的问题与 Bug\n\n`;
    failedTests.forEach((result, index) => {
      markdown += `### ${index + 1}. ${result.testName}\n\n`;
      markdown += `- **状态**: ❌ 失败\n`;
      if (result.error) {
        markdown += `- **错误**: ${result.error}\n`;
      }
      if (result.details) {
        markdown += `- **详情**: \n\`\`\`json\n${JSON.stringify(result.details, null, 2)}\n\`\`\`\n`;
      }
      markdown += `\n`;
    });
  }

  // 结论
  markdown += `## 结论\n\n`;
  markdown += `### 总体评价\n\n`;
  
  if (summary.failed === 0) {
    markdown += `✅ 所有测试通过，系统运行正常。\n\n`;
  } else if (summary.failed < summary.total / 2) {
    markdown += `⚠️ 大部分测试通过，但存在一些问题需要修复。\n\n`;
  } else {
    markdown += `❌ 多个测试失败，系统存在严重问题。\n\n`;
  }

  markdown += `### 通过标准\n\n`;
  markdown += `- ${summary.failed === 0 ? "✅" : "❌"} 所有核心功能正常工作\n`;
  markdown += `- ${summary.averageDuration < 5000 ? "✅" : "⚠️"} 性能指标符合预期\n`;
  markdown += `- ${summary.failed === 0 ? "✅" : "❌"} 无严重 Bug\n\n`;

  markdown += `---\n\n`;
  markdown += `**报告生成时间**: ${new Date().toLocaleString()}\n`;
  markdown += `**报告版本**: v1.0\n`;

  return markdown;
}

/**
 * 下载测试报告
 */
export function downloadReport(report: TestReport, format: "json" | "markdown" = "markdown") {
  let content: string;
  let filename: string;
  let mimeType: string;

  if (format === "json") {
    content = JSON.stringify(report, null, 2);
    filename = `integration-test-report-${Date.now()}.json`;
    mimeType = "application/json";
  } else {
    content = generateMarkdownReport(report);
    filename = `integration-test-report-${Date.now()}.md`;
    mimeType = "text/markdown";
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

