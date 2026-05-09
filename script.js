// ==UserScript==
// @name         DeepSeek 极简用量看板
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  在 DeepSeek 官方用量图表上方，重构一个包含多维折线图和可读性文本的极简数据面板。
// @author       Nahiyi
// @match        https://platform.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepseek.com
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let capturedData = null;
    let isRendered = false;

    function formatUnit(numStr) {
        const n = Number(numStr);
        if (isNaN(n) || n === 0) return '0';
        if (n < 10000) return n.toLocaleString();
        if (n < 1000000) return (n / 10000).toFixed(2) + ' 万';
        if (n < 100000000) return (n / 1000000).toFixed(2) + ' 百万';
        return (n / 100000000).toFixed(2) + ' 亿';
    }

    function renderDashboard() {
        if (isRendered || !capturedData) return;

        const bizData = capturedData?.data?.biz_data;
        if (!bizData || !bizData.days || !bizData.total) return;

        const containerInfo = document.querySelector('.main-content') || document.querySelector('main');
        if (!containerInfo) {
            setTimeout(renderDashboard, 500);
            return;
        }

        if (document.getElementById('nahiyi-ds-top-dashboard')) {
            document.getElementById('nahiyi-ds-top-dashboard').remove();
        }

        const dashboard = document.createElement('div');
        dashboard.id = 'nahiyi-ds-top-dashboard';
        dashboard.style.cssText = `
            margin: 20px;
            padding: 24px;
            background: rgba(255, 255, 255, 0.6);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(200, 200, 200, 0.4);
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
            display: flex;
            gap: 24px;
            z-index: 100;
        `;

        const modelsToRender = ['deepseek-v4-pro', 'deepseek-v4-flash'];

        modelsToRender.forEach(modelName => {
            const totalUsage = bizData.total.find(m => m.model === modelName);
            let hitTotal = 0, missTotal = 0, outTotal = 0;

            if (totalUsage) {
                hitTotal = Number(totalUsage.usage.find(u => u.type === 'PROMPT_CACHE_HIT_TOKEN')?.amount || 0);
                missTotal = Number(totalUsage.usage.find(u => u.type === 'PROMPT_CACHE_MISS_TOKEN')?.amount || 0);
                outTotal = Number(totalUsage.usage.find(u => u.type === 'RESPONSE_TOKEN')?.amount || 0);
            }

            const totalInput = hitTotal + missTotal;
            const hitRate = totalInput > 0 ? ((hitTotal / totalInput) * 100).toFixed(2) + '%' : '0.00%';

            const labels = [];
            const hitData = [];
            const missData = [];
            const outData = [];

            bizData.days.forEach(dayInfo => {
                labels.push(dayInfo.date.slice(5)); // 取 MM-DD
                const modelDayUsage = dayInfo.data.find(m => m.model === modelName);
                if (modelDayUsage) {
                    hitData.push(Number(modelDayUsage.usage.find(u => u.type === 'PROMPT_CACHE_HIT_TOKEN')?.amount || 0));
                    missData.push(Number(modelDayUsage.usage.find(u => u.type === 'PROMPT_CACHE_MISS_TOKEN')?.amount || 0));
                    outData.push(Number(modelDayUsage.usage.find(u => u.type === 'RESPONSE_TOKEN')?.amount || 0));
                } else {
                    hitData.push(0); missData.push(0); outData.push(0);
                }
            });

            const card = document.createElement('div');
            card.style.cssText = `
                flex: 1;
                background: rgba(255, 255, 255, 0.9);
                border-radius: 8px;
                padding: 16px;
                border: 1px solid #f0f0f0;
                display: flex;
                flex-direction: column;
                gap: 16px;
            `;

            const canvasId = `nahiyi-chart-${modelName}`;

            card.innerHTML = `
                <!-- 顶部汇总文本区 -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h3 style="margin: 0 0 4px 0; font-size: 16px; color: #111;">${modelName}</h3>
                        <span style="font-size: 13px; color: #10b981; font-weight: 600; background: rgba(16,185,129,0.1); padding: 2px 6px; border-radius: 4px;">
                            缓存命中率: ${hitRate}
                        </span>
                    </div>
                    <div style="font-size: 13px; color: #555; text-align: right; line-height: 1.6;">
                        <div>输入命中: <span style="font-weight:600; color:#3b82f6">${formatUnit(hitTotal)}</span></div>
                        <div>输入未命: <span style="font-weight:600; color:#94a3b8">${formatUnit(missTotal)}</span></div>
                        <div>普通输出: <span style="font-weight:600; color:#f59e0b">${formatUnit(outTotal)}</span></div>
                    </div>
                </div>
                
                <!-- 底部折线图容器 -->
                <div style="position: relative; height: 160px; width: 100%;">
                    <canvas id="${canvasId}"></canvas>
                </div>
            `;

            dashboard.appendChild(card);

            setTimeout(() => {
                const ctx = document.getElementById(canvasId).getContext('2d');
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: '输入缓存命中',
                                data: hitData,
                                borderColor: '#3b82f6',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                tension: 0.3,
                                fill: true,
                                borderWidth: 2,
                                pointRadius: 2,
                                pointHoverRadius: 5
                            },
                            {
                                label: '输入缓存未命中',
                                data: missData,
                                borderColor: '#94a3b8',
                                tension: 0.3,
                                fill: false,
                                borderWidth: 2,
                                pointRadius: 0
                            },
                            {
                                label: '普通输出',
                                data: outData,
                                borderColor: '#f59e0b',
                                tension: 0.3,
                                fill: false,
                                borderWidth: 2,
                                pointRadius: 0
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: { boxWidth: 12, font: { size: 11 } }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function (context) {
                                        let label = context.dataset.label || '';
                                        if (label) label += ': ';
                                        if (context.parsed.y !== null) {
                                            label += formatUnit(context.parsed.y);
                                        }
                                        return label;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 10 }, maxTicksLimit: 10 }
                            },
                            y: {
                                grid: { color: 'rgba(0,0,0,0.04)' },
                                ticks: {
                                    font: { size: 10 },
                                    callback: function (value) {
                                        return formatUnit(value);
                                    }
                                }
                            }
                        }
                    }
                });
            }, 100);
        });

        containerInfo.insertBefore(dashboard, containerInfo.firstChild);
        isRendered = true;
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = args[0] instanceof Request ? args[0].url : args[0];
            if (url && url.includes('/api/v0/usage/amount')) {
                const clone = response.clone();
                clone.json().then(data => {
                    capturedData = data;
                    isRendered = false; // 触发刷新
                    renderDashboard();
                }).catch(err => console.error("[Nahiyi] 解析 JSON 失败", err));
            }
        } catch (e) { }
        return response;
    };

    const originalXHR = window.XMLHttpRequest;
    function newXHR() {
        const xhr = new originalXHR();
        xhr.addEventListener('load', function () {
            if (xhr.responseURL && xhr.responseURL.includes('/api/v0/usage/amount')) {
                try {
                    capturedData = JSON.parse(xhr.responseText);
                    isRendered = false;
                    renderDashboard();
                } catch (e) { }
            }
        });
        return xhr;
    }
    window.XMLHttpRequest = newXHR;

})();