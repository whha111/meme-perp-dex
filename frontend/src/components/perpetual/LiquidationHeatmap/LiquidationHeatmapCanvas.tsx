"use client";

/**
 * 清算热力图Canvas渲染器
 *
 * 使用Canvas API高性能渲染2D热力图
 */

import { useRef, useEffect, useState, useCallback } from "react";
import type { LiquidationHeatmapData, HeatmapTooltipData } from "./types";
import { getHeatmapColor, formatPrice, formatTime, formatUsdAmount } from "./heatmapUtils";

interface Props {
  data: LiquidationHeatmapData;
  width?: number;
  height?: number;
  onHover?: (tooltipData: HeatmapTooltipData | null) => void;
}

const PADDING = { top: 15, right: 50, bottom: 30, left: 60 };

export function LiquidationHeatmapCanvas({
  data,
  width = 600,
  height = 300,
  onHover,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredCell, setHoveredCell] = useState<{ priceLevel: number; timeSlot: number } | null>(null);

  // 计算绘图区域尺寸
  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = height - PADDING.top - PADDING.bottom;
  const cellWidth = chartWidth / data.timeSlots;
  const cellHeight = chartHeight / data.priceLevels;

  // 绘制热力图
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 设置高DPI支持
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // 清空画布
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    // 绘制热力图单元格
    const priceMin = Number(data.priceMin) / 1e18;
    const priceMax = Number(data.priceMax) / 1e18;
    const priceStep = (priceMax - priceMin) / data.priceLevels;
    const currentPriceNum = Number(data.currentPrice) / 1e18;

    // 计算当前价格的Y位置
    const currentPriceY = PADDING.top + chartHeight - ((currentPriceNum - priceMin) / (priceMax - priceMin)) * chartHeight;

    // 绘制单元格
    for (const cell of data.heatmap) {
      const x = PADDING.left + cell.timeSlot * cellWidth;
      const y = PADDING.top + (data.priceLevels - 1 - cell.priceLevel) * cellHeight;

      // 设置颜色 (基于强度)
      ctx.fillStyle = getHeatmapColor(cell.intensity);
      ctx.fillRect(x, y, cellWidth - 1, cellHeight - 1);

      // 高亮悬停的单元格
      if (hoveredCell &&
          hoveredCell.priceLevel === cell.priceLevel &&
          hoveredCell.timeSlot === cell.timeSlot) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cellWidth - 1, cellHeight - 1);
      }
    }

    // 绘制当前价格线
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, currentPriceY);
    ctx.lineTo(PADDING.left + chartWidth, currentPriceY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 当前价格标签
    ctx.fillStyle = "#facc15";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(formatPrice(data.currentPrice), PADDING.left + chartWidth + 5, currentPriceY + 3);

    // 绘制Y轴 (价格)
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";

    for (let i = 0; i <= 4; i++) {
      const price = priceMin + (priceMax - priceMin) * (i / 4);
      const y = PADDING.top + chartHeight - (i / 4) * chartHeight;
      ctx.fillText(formatPrice(price * 1e12), PADDING.left - 5, y + 3);

      // 网格线
      ctx.strokeStyle = "rgba(156, 163, 175, 0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(PADDING.left + chartWidth, y);
      ctx.stroke();
    }

    // 绘制X轴 (时间)
    ctx.textAlign = "center";
    const timeStep = (data.timeEnd - data.timeStart) / 4;

    for (let i = 0; i <= 4; i++) {
      const time = data.timeStart + timeStep * i;
      const x = PADDING.left + (i / 4) * chartWidth;
      ctx.fillText(formatTime(time), x, height - PADDING.bottom + 15);

      // 网格线
      if (i > 0 && i < 4) {
        ctx.strokeStyle = "rgba(156, 163, 175, 0.1)";
        ctx.beginPath();
        ctx.moveTo(x, PADDING.top);
        ctx.lineTo(x, PADDING.top + chartHeight);
        ctx.stroke();
      }
    }

  }, [data, width, height, chartWidth, chartHeight, cellWidth, cellHeight, hoveredCell]);

  // 处理鼠标移动
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 检查是否在绘图区域内
    if (x < PADDING.left || x > PADDING.left + chartWidth ||
        y < PADDING.top || y > PADDING.top + chartHeight) {
      setHoveredCell(null);
      onHover?.(null);
      return;
    }

    // 计算悬停的单元格
    const timeSlot = Math.floor((x - PADDING.left) / cellWidth);
    const priceLevel = data.priceLevels - 1 - Math.floor((y - PADDING.top) / cellHeight);

    if (timeSlot < 0 || timeSlot >= data.timeSlots ||
        priceLevel < 0 || priceLevel >= data.priceLevels) {
      setHoveredCell(null);
      onHover?.(null);
      return;
    }

    setHoveredCell({ priceLevel, timeSlot });

    // 找到对应的单元格数据
    const cell = data.heatmap.find(
      c => c.priceLevel === priceLevel && c.timeSlot === timeSlot
    );

    if (cell) {
      const priceMin = Number(data.priceMin) / 1e18;
      const priceMax = Number(data.priceMax) / 1e18;
      const priceStep = (priceMax - priceMin) / data.priceLevels;
      const price = priceMin + priceStep * priceLevel;
      const time = data.timeStart + ((data.timeEnd - data.timeStart) / data.timeSlots) * timeSlot;

      onHover?.({
        priceLevel,
        timeSlot,
        price: formatPrice(price * 1e12),
        time: formatTime(time),
        longSize: cell.longLiquidationSize,
        shortSize: cell.shortLiquidationSize,
        longCount: cell.longAccountCount,
        shortCount: cell.shortAccountCount,
        x: e.clientX,
        y: e.clientY,
      });
    }
  }, [data, chartWidth, chartHeight, cellWidth, cellHeight, onHover]);

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null);
    onHover?.(null);
  }, [onHover]);

  return (
    <canvas
      ref={canvasRef}
      className="cursor-crosshair"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}
