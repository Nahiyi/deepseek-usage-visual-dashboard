// ==UserScript==
// @name         DeepSeek 极简用量看板
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  全宽单行卡片，Flash优先，严谨的周一至周日统计，严格阶梯中文单位（十万/百万/千万/亿），保留极简毛玻璃美学。
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
    let currentSpan = 'thisWeek'; // 默认本周 (周一至周日)
    let chartInstances = {};   

    function formatUnit(numStr) {
        const n = Number(numStr);
        if (isNaN(n) || n === 0) return '0';
        
        if (n < 10000) return n.toLocaleString(); 
        if (n < 100000) return (n / 10000).toFixed(2) + ' 万';
        if (n < 1000000) return (n / 100000).toFixed(2) + ' 十万';
        if (n < 10000000) return (n / 1000000).toFixed(2) + ' 百万';
        if (n < 100000000) return (n / 10000000).toFixed(2) + ' 千万';
        return (n / 100000000).toFixed(2) + ' 亿';
    }

    function getDS(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
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
            margin: 20px 0; padding: 20px 24px;
            background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(200, 200, 200, 0.4); border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
            display: flex; flex-direction: column; gap: 16px; z-index: 100;
        `;

        dashboard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 12px;">
                <div style="font-size: 16px; font-weight: 600; color: #333;">Token 用量深度看板</div>
                <div id="nahiyi-span-controls" style="display: flex; gap: 8px; background: rgba(0,0,0,0.03); padding: 4px; border-radius: 8px;">
                    <button data-span="today" class="nh-btn">当天</button>
                    <button data-span="thisWeek" class="nh-btn active">本周</button>
                    <button data-span="1month" class="nh-btn">本月</button>
                </div>
            </div>
            <!-- 卡片容器改为纵向排列 -->
            <div id="nahiyi-cards-container" style="display: flex; flex-direction: column; gap: 24px;"></div>
            <style>
                .nh-btn {
                    border: none; background: transparent; padding: 6px 16px; border-radius: 6px;
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

        let daysArray = bizData.days;
        let filteredDays = [];

        // 核心跨度算法
        if (currentSpan === 'today') {
            const localToday = getDS(new Date());
            filteredDays = daysArray.filter(d => d.date === localToday);
            if (filteredDays.length === 0 && daysArray.length > 0) {
                 filteredDays = [daysArray[daysArray.length - 1]]; // 兜底最新的一天
            }
        } else if (currentSpan === 'thisWeek') {
            const now = new Date();
            const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); 
            
            const monday = new Date(now);
            monday.setDate(now.getDate() - dayOfWeek + 1);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            
            const monStr = getDS(monday);
            const sunStr = getDS(sunday);
            
            filteredDays = daysArray.filter(d => d.date >= monStr && d.date <= sunStr);
        } else {
            filteredDays = daysArray;
        }

        const modelsToRender = ['deepseek-v4-flash', 'deepseek-v4-pro'];

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
            card.style.cssText = `
                width: 100%; box-sizing: border-box; background: rgba(255, 255, 255, 0.9); 
                border-radius: 12px; padding: 24px; border: 1px solid #f0f0f0; 
                display: flex; flex-direction: column; gap: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.02);
            `;
            const canvasId = `nahiyi-chart-${modelName}`;

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h3 style="margin: 0 0 6px 0; font-size: 18px; color: #111;">${modelName}</h3>
                        <span style="font-size: 14px; color: #10b981; font-weight: 600; background: rgba(16,185,129,0.1); padding: 4px 8px; border-radius: 6px;">综合命中率: ${hitRate}</span>
                    </div>
                    <div style="font-size: 14px; color: #555; text-align: right; line-height: 1.8;">
                        <div>输入命中: <span style="font-weight:600; color:#3b82f6; margin-left: 8px;">${formatUnit(hitTotal)}</span></div>
                        <div>输入未命: <span style="font-weight:600; color:#94a3b8; margin-left: 8px;">${formatUnit(missTotal)}</span></div>
                        <div>输出: <span style="font-weight:600; color:#f59e0b; margin-left: 8px;">${formatUnit(outTotal)}</span></div>
                    </div>
                </div>
                <div style="position: relative; height: 240px; width: 100%;"><canvas id="${canvasId}"></canvas></div>
            `;
            container.appendChild(card);

            setTimeout(() => {
                const ctx = document.getElementById(canvasId).getContext('2d');
                if (chartInstances[canvasId]) chartInstances[canvasId].destroy(); 

                chartInstances[canvasId] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: '输入命中', data: hitData, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.3, fill: true, borderWidth: 2, pointRadius: 3, pointHoverRadius: 6 },
                            { label: '输入未命中', data: missData, borderColor: '#94a3b8', tension: 0.3, fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
                            { label: '输出', data: outData, borderColor: '#f59e0b', tension: 0.3, fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 }, padding: 20 } },
                            tooltip: {
                                padding: 12,
                                bodySpacing: 6,
                                titleFont: { size: 14 },
                                bodyFont: { size: 13 },
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
                            x: { grid: { display: false }, ticks: { font: { size: 11 }, maxTicksLimit: 14 } },
                            y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 }, callback: function(value) { return formatUnit(value); } } }
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
                }).catch(err => console.error("解析 JSON 失败", err));
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