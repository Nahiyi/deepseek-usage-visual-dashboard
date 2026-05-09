// ==UserScript==
// @name         DeepSeek 极简用量看板
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  增加当天/7天/1个月跨度切换，严格中文阶梯单位，图表悬浮显示每日命中率。
// @author       Nahiyi
// @match        https://platform.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepseek.com
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 全局状态管理
    let capturedData = null;
    let currentSpan = '7days'; // 默认 7 天
    let chartInstances = {};   // 存储 Chart 实例以备销毁重绘

    function formatUnit(numStr) {
        const n = Number(numStr);
        if (isNaN(n) || n === 0) return '0';
        
        if (n < 10000) return n.toString();
        if (n < 100000) return (n / 10000).toFixed(2) + ' 万';
        if (n < 1000000) return (n / 100000).toFixed(2) + ' 十万';
        if (n < 10000000) return (n / 1000000).toFixed(2) + ' 百万';
        if (n < 100000000) return (n / 10000000).toFixed(2) + ' 千万';
        return (n / 100000000).toFixed(2) + ' 亿';
    }

    function initDashboardLayout() {
        const containerInfo = document.querySelector('.main-content') || document.querySelector('main');
        if (!containerInfo) {
            setTimeout(initDashboardLayout, 500);
            return;
        }

        if (document.getElementById('nahiyi-ds-top-dashboard')) return;

        const dashboard = document.createElement('div');
        dashboard.id = 'nahiyi-ds-top-dashboard';
        dashboard.style.cssText = `
            margin: 20px; padding: 20px 24px;
            background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(200, 200, 200, 0.4); border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
            display: flex; flex-direction: column; gap: 16px; z-index: 100;
        `;

        dashboard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 12px;">
                <div style="font-size: 15px; font-weight: 600; color: #333;">Token 用量核心看板</div>
                <div id="nahiyi-span-controls" style="display: flex; gap: 8px; background: rgba(0,0,0,0.03); padding: 4px; border-radius: 8px;">
                    <button data-span="today" class="nh-btn">当天</button>
                    <button data-span="7days" class="nh-btn active">7天</button>
                    <button data-span="1month" class="nh-btn">一个月</button>
                </div>
            </div>
            <div id="nahiyi-cards-container" style="display: flex; gap: 24px;"></div>
            <style>
                .nh-btn {
                    border: none; background: transparent; padding: 4px 12px; border-radius: 6px;
                    font-size: 13px; color: #666; cursor: pointer; transition: all 0.2s;
                }
                .nh-btn:hover { color: #3b82f6; }
                .nh-btn.active { background: #fff; color: #3b82f6; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
            </style>
        `;

        containerInfo.insertBefore(dashboard, containerInfo.firstChild);

        document.getElementById('nahiyi-span-controls').addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                document.querySelectorAll('.nh-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                currentSpan = e.target.getAttribute('data-span');
                renderCards();
            }
        });
    }

    function renderCards() {
        const bizData = capturedData?.data?.biz_data;
        if (!bizData || !bizData.days) return;

        const container = document.getElementById('nahiyi-cards-container');
        if (!container) return;
        container.innerHTML = '';

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const localToday = `${yyyy}-${mm}-${dd}`;

        let daysArray = bizData.days;
        let todayIdx = daysArray.findIndex(d => d.date === localToday);
        if (todayIdx === -1) todayIdx = daysArray.length - 1; // 兜底：如果没找到当天，取数据最后一天

        let filteredDays = [];
        if (currentSpan === 'today') {
            filteredDays = [daysArray[todayIdx]];
        } else if (currentSpan === '7days') {
            let start = Math.max(0, todayIdx - 6);
            filteredDays = daysArray.slice(start, todayIdx + 1);
        } else {
            filteredDays = daysArray; // 一个月
        }

        const modelsToRender = ['deepseek-v4-pro', 'deepseek-v4-flash'];

        modelsToRender.forEach(modelName => {
            let hitTotal = 0, missTotal = 0, outTotal = 0;
            const labels = [], hitData = [], missData = [], outData = [];

            filteredDays.forEach(dayInfo => {
                labels.push(dayInfo.date.slice(5)); // 取 MM-DD
                const modelDayUsage = dayInfo.data.find(m => m.model === modelName);
                
                let dHit = 0, dMiss = 0, dOut = 0;
                if (modelDayUsage) {
                    dHit = Number(modelDayUsage.usage.find(u => u.type === 'PROMPT_CACHE_HIT_TOKEN')?.amount || 0);
                    dMiss = Number(modelDayUsage.usage.find(u => u.type === 'PROMPT_CACHE_MISS_TOKEN')?.amount || 0);
                    dOut = Number(modelDayUsage.usage.find(u => u.type === 'RESPONSE_TOKEN')?.amount || 0);
                }
                
                hitTotal += dHit; missTotal += dMiss; outTotal += dOut;
                hitData.push(dHit); missData.push(dMiss); outData.push(dOut);
            });

            const totalInput = hitTotal + missTotal;
            const hitRate = totalInput > 0 ? ((hitTotal / totalInput) * 100).toFixed(2) + '%' : '0.00%';

            const card = document.createElement('div');
            card.style.cssText = `flex: 1; background: rgba(255, 255, 255, 0.9); border-radius: 8px; padding: 16px; border: 1px solid #f0f0f0; display: flex; flex-direction: column; gap: 16px;`;
            const canvasId = `nahiyi-chart-${modelName}`;

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h3 style="margin: 0 0 4px 0; font-size: 16px; color: #111;">${modelName}</h3>
                        <span style="font-size: 13px; color: #10b981; font-weight: 600; background: rgba(16,185,129,0.1); padding: 2px 6px; border-radius: 4px;">当前跨度命中率: ${hitRate}</span>
                    </div>
                    <div style="font-size: 13px; color: #555; text-align: right; line-height: 1.6;">
                        <div>输入命中: <span style="font-weight:600; color:#3b82f6">${formatUnit(hitTotal)}</span></div>
                        <div>输入未命: <span style="font-weight:600; color:#94a3b8">${formatUnit(missTotal)}</span></div>
                        <div>输出: <span style="font-weight:600; color:#f59e0b">${formatUnit(outTotal)}</span></div>
                    </div>
                </div>
                <div style="position: relative; height: 160px; width: 100%;"><canvas id="${canvasId}"></canvas></div>
            `;
            container.appendChild(card);
            
            setTimeout(() => {
                const ctx = document.getElementById(canvasId).getContext('2d');
                if (chartInstances[canvasId]) chartInstances[canvasId].destroy(); // 销毁旧实例防止重叠报错

                chartInstances[canvasId] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: '输入命中', data: hitData, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.3, fill: true, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5 },
                            { label: '输入未命中', data: missData, borderColor: '#94a3b8', tension: 0.3, fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
                            { label: '输出', data: outData, borderColor: '#f59e0b', tension: 0.3, fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        let label = context.dataset.label || '';
                                        if (label) label += ': ';
                                        if (context.parsed.y !== null) label += formatUnit(context.parsed.y);
                                        return label;
                                    },
                                    afterBody: function(tooltipItems) {
                                        let hit = 0, miss = 0;
                                        tooltipItems.forEach(item => {
                                            if (item.dataset.label === '输入命中') hit = item.parsed.y;
                                            if (item.dataset.label === '输入未命中') miss = item.parsed.y;
                                        });
                                        const dailyTotal = hit + miss;
                                        const dailyRate = dailyTotal > 0 ? ((hit / dailyTotal) * 100).toFixed(2) + '%' : '0.00%';
                                        return `\n► 当日缓存命中率: ${dailyRate}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 10 } },
                            y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10 }, callback: function(value) { return formatUnit(value); } } }
                        }
                    }
                });
            }, 50);
        });
    }

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = args[0] instanceof Request ? args[0].url : args[0];
            if (url && url.includes('/api/v0/usage/amount')) {
                const clone = response.clone();
                clone.json().then(data => {
                    capturedData = data;
                    initDashboardLayout();
                    renderCards();
                }).catch(err => console.error("[Nahiyi] 解析 JSON 失败", err));
            }
        } catch (e) {}
        return response;
    };

    const originalXHR = window.XMLHttpRequest;
    function newXHR() {
        const xhr = new originalXHR();
        xhr.addEventListener('load', function() {
            if (xhr.responseURL && xhr.responseURL.includes('/api/v0/usage/amount')) {
                try {
                    capturedData = JSON.parse(xhr.responseText);
                    initDashboardLayout();
                    renderCards();
                } catch (e) {}
            }
        });
        return xhr;
    }
    window.XMLHttpRequest = newXHR;

})();