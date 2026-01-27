/**
 * 主测试运行器 - 按顺序执行所有测试
 *
 * 使用方法: npx ts-node test/run-all-tests.ts
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP" | "ERROR";
  error?: string;
  duration?: number;
}

const tests = [
  { file: "00-setup.ts", name: "环境准备" },
  { file: "01-deposit.ts", name: "USDT 充值" },
  { file: "02-market-open.ts", name: "市价开仓" },
  { file: "03-limit-open.ts", name: "限价开仓" },
  { file: "04-close-position.ts", name: "平仓" },
  { file: "05-liquidation.ts", name: "爆仓清算" },
  { file: "06-funding-rate.ts", name: "资金费率" },
  { file: "07-withdraw.ts", name: "盈利提现" },
  { file: "08-precision.ts", name: "精度测试" },
  { file: "09-status-check.ts", name: "状态检查" },
];

async function main() {
  console.log("=".repeat(60));
  console.log("永续合约全面测试");
  console.log("=".repeat(60));
  console.log(`测试时间: ${new Date().toLocaleString()}`);
  console.log(`测试数量: ${tests.length}`);
  console.log("");

  const results: TestResult[] = [];
  const scriptDir = __dirname;

  for (const test of tests) {
    console.log("\n" + "=".repeat(60));
    console.log(`运行测试: ${test.name} (${test.file})`);
    console.log("=".repeat(60));

    const startTime = Date.now();

    try {
      const output = execSync(`npx ts-node ${path.join(scriptDir, test.file)}`, {
        encoding: "utf-8",
        timeout: 300000, // 5 分钟超时
        cwd: path.dirname(scriptDir),
      });

      console.log(output);

      const duration = Date.now() - startTime;

      // 检查输出中是否有失败
      if (output.includes("失败:") && !output.includes("失败: 0")) {
        results.push({ name: test.name, status: "FAIL", duration });
      } else {
        results.push({ name: test.name, status: "PASS", duration });
      }
    } catch (e: any) {
      const duration = Date.now() - startTime;
      console.log(`\n错误: ${e.message}`);
      if (e.stdout) console.log(e.stdout);
      if (e.stderr) console.log(e.stderr);

      results.push({
        name: test.name,
        status: "ERROR",
        error: e.message.slice(0, 100),
        duration,
      });
    }

    // 测试间隔
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 生成测试报告
  console.log("\n" + "=".repeat(60));
  console.log("测试报告");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const errors = results.filter((r) => r.status === "ERROR").length;

  console.log(`\n总计: ${results.length} | 通过: ${passed} | 失败: ${failed} | 错误: ${errors}`);
  console.log("");

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⚠️";
    const duration = r.duration ? ` (${(r.duration / 1000).toFixed(1)}s)` : "";
    console.log(`${icon} ${r.name}${duration}`);
    if (r.error) console.log(`   Error: ${r.error}`);
  }

  // 保存报告
  const reportPath = path.join(scriptDir, "test-report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: { total: results.length, passed, failed, errors },
        results,
      },
      null,
      2
    )
  );
  console.log(`\n报告已保存: ${reportPath}`);

  // 返回状态码
  if (failed > 0 || errors > 0) {
    console.log("\n测试未全部通过，请检查失败项目。");
    process.exit(1);
  } else {
    console.log("\n所有测试通过！");
    process.exit(0);
  }
}

main().catch(console.error);
