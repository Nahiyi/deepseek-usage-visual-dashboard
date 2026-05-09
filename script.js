// ==UserScript==
// @name         DeepSeek V4 用量增强看板
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  在右侧构建极简趋势看板，支持单位转换、命中率分析及多维度时间切换。
// @author       Nahiyi
// @match        https://platform.deepseek.com/*
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let rawUsageData = null;
    let currentRange = 'week'; // 默认一周

    function formatUnit(numStr) {
        const n = Number(numStr);
        if (isNaN(n) || n === 0) return '0';
        if (n < 10000) return n.toLocaleString();
        if (n < 1000000) return (n / 10000).toFixed(1) + ' 万';
        if (n < 100000000) return (n / 1000000).toFixed(1) + ' 百万';
        return (n / 100000000).toFixed(2) + ' 亿';
    }

    const getDS = (d) => d.toISOString().split('T')[0];

    function getStats(range) {
        if (!rawUsageData) return null;
        const days = rawUsageData.data.biz_data.days;
        const today = new Date("2026-05-09");
        
        let targetDays = [];
        if (range === 'today') targetDays = [getDS(today)];
        else if (range === 'yesterday') {
            const yest = new Date(today);
            yest.setDate(yest.getDate() - 1);
            targetDays = [getDS(yest)];
        } else if (range === 'week') {
            for(let i=6; i>=0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                targetDays.push(getDS(d));
            }
        } else { // month
            targetDays = days.map(d => d.date);
        }

        const models = ['deepseek-v4-pro', 'deepseek-v4-flash'];
        let result = {};

        models.forEach(m => {
            let hit = 0, miss = 0, out = 0;
            let chartData = [];
            let chartLabels = [];

            targetDays.forEach(dateStr => {
                const dayObj = days.find(d => d.date === dateStr);
                const modelUsage = dayObj?.data.find(du => du.model === m);
                
                let d_hit = 0, d_miss = 0, d_out = 0;
                if (modelUsage) {
                    d_hit = Number(modelUsage.usage.find(u => u.type === 'PROMPT_CACHE_HIT_TOKEN')?.amount || 0);
                    d_miss = Number(modelUsage.usage.find(u => u.type === 'PROMPT_CACHE_MISS_TOKEN')?.amount || 0);
                    d_out = Number(modelUsage.usage.find(u => u.type === 'RESPONSE_TOKEN')?.amount || 0);
                }
                hit += d_hit; miss += d_miss; out += d_out;
                chartData.push(d_hit + d_miss + d_out);
                chartLabels.push(dateStr.split('-').slice(1).join('/'));
            });

            const totalIn = hit + miss;
            result[m] = {
                hit, miss, out,
                hitRate: totalIn > 0 ? ((hit / totalIn) * 100).toFixed(1) + '%' : '0%',
                chartData,
                chartLabels,
                displayDate: range === 'today' ? targetDays[0] : `${targetDays[0]} ~ ${targetDays[targetDays.length-1]}`
            };
        });
        return result;
    }

    function initUI() {
        if (document.getElementById('ds-side-panel')) return;

        const sidePanel = document.createElement('div');
        sidePanel.id = 'ds-side-panel';
        sidePanel.style.cssText = `
            position: fixed; right: 20px; top: 80px; width: 320px; bottom: 20px;
            background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(15px);
            border: 1px solid rgba(0,0,0,0.08); border-radius: 16px;
            box-shadow: -10px 0 30px rgba(0,0,0,0.05); z-index: 1000;
            display: flex; flex-direction: column; overflow: hidden; font-family: sans-serif;
        `;

        sidePanel.innerHTML = `
            <div style="padding: 20px; border-bottom: 1px solid rgba(0,0,0,0.05)">
                <div style="font-weight: 600; font-size: 18px; color: #1a1a1a; margin-bottom: 12px;">用量趋势分析</div>
                <div id="ds-range-selector" style="display: flex; gap: 8px;">
                    <button data-r="today" style="${btnStyle}">今天</button>
                    <button data-r="yesterday" style="${btnStyle}">昨天</button>
                    <button data-r="week" style="${btnStyle} background:#3b82f6; color:white;">一周</button>
                    <button data-r="month" style="${btnStyle}">本月</button>
                </div>
            </div>
            <div id="ds-content-area" style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 24px;">
                <div style="text-align: center; color: #999; margin-top: 50px;">等待接口数据加载...</div>
            </div>
        `;
        document.body.appendChild(sidePanel);

        // 事件委托
        sidePanel.addEventListener('click', (e) => {
            if (e.target.dataset.r) {
                currentRange = e.target.dataset.r;
                updateRangeButtons();
                renderData();
            }
        });
    }

    const btnStyle = `padding: 4px 12px; border-radius: 6px; border: 1px solid #eee; background: white; cursor: pointer; font-size: 12px; transition: all 0.2s;`;

    function updateRangeButtons() {
        const btns = document.querySelectorAll('#ds-range-selector button');
        btns.forEach(b => {
            if (b.dataset.r === currentRange) {
                b.style.background = '#3b82f6'; b.style.color = 'white';
            } else {
                b.style.background = 'white'; b.style.color = '#666';
            }
        });
    }

    function renderData() {
        const stats = getStats(currentRange);
        if (!stats) return;

        const area = document.getElementById('ds-content-area');
        area.innerHTML = '';

        ['deepseek-v4-pro', 'deepseek-v4-flash'].forEach(m => {
            const data = stats[m];
            const card = document.createElement('div');
            card.innerHTML = `
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 14px; font-weight: 600; color: #444; display: flex; justify-content: space-between;">
                        <span>${m.replace('deepseek-', '').toUpperCase()}</span>
                        <span style="color: #10b981;">命中率 ${data.hitRate}</span>
                    </div>
                    <div style="font-size: 11px; color: #999; margin-bottom: 12px;">${data.displayDate}</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                    ${itemUI("命中输入", data.hit, "#60a5fa")}
                    ${itemUI("未命输入", data.miss, "#94a3b8")}
                    ${itemUI("输出Token", data.out, "#3b82f6")}
                    ${itemUI("合计", data.hit + data.miss + data.out, "#1e293b")}
                </div>
                <canvas id="chart-${m}" height="100"></canvas>
            `;
            area.appendChild(card);

            // 绘制曲线图
            new Chart(document.getElementById(`chart-${m}`), {
                type: 'line',
                data: {
                    labels: data.chartLabels,
                    datasets: [{
                        label: 'Total Tokens',
                        data: data.chartData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0
                    }]
                },
                options: {
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { display: false },
                        y: { display: false }
                    }
                }
            });
        });
    }

    function itemUI(label, val, color) {
        return `
            <div style="background: rgba(0,0,0,0.03); padding: 8px; border-radius: 8px;">
                <div style="font-size: 10px; color: #888;">${label}</div>
                <div style="font-size: 13px; font-weight: 600; color: ${color};">${formatUnit(val)}</div>
            </div>
        `;
    }

    const originFetch = window.fetch;
    window.fetch = async (...args) => {
        const res = await originFetch(...args);
        const url = args[0] instanceof Request ? args[0].url : args[0];
        if (url.includes('/api/v0/usage/amount')) {
            const clone = res.clone();
            clone.json().then(data => {
                rawUsageData = data;
                initUI();
                renderData();
            });
        }
        return res;
    };

})();