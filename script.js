// ==UserScript==
// @name         DeepSeek 增强用量看板
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  三大接口联合劫持，三徽章并排（命中率/成本/请求数），并绘制 CC-Switch 同款的丰富图表。
// @author       Nahiyi
// @match        https://platform.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepseek.com
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let capturedAmountData = null;
    let capturedCostData = null;
    let capturedSummaryData = null; 
    let currentSpan = 'thisWeek'; 
    let chartInstances = {};   
    let isDarkMode = false;
    let themeCheckInterval = null;

    function injectThemeStyles() {
        if (document.getElementById('nahiyi-ds-theme-styles')) return;
        const style = document.createElement('style');
        style.id = 'nahiyi-ds-theme-styles';
        
        style.innerHTML = `
            #nahiyi-ds-top-dashboard {
                --nh-bg-dash: rgba(255, 255, 255, 0.6);
                --nh-border-dash: rgba(200, 200, 200, 0.4);
                --nh-text-title: #333;
                --nh-text-main: #111;
                --nh-text-sub: #555;
                --nh-text-muted: #666;
                --nh-bg-controls: rgba(0,0,0,0.03);
                --nh-bg-card: rgba(255, 255, 255, 0.9);
                --nh-border-card: #f0f0f0;
                --nh-bg-btn-active: #fff;
                --nh-shadow-card: rgba(0, 0, 0, 0.02);
            }
            #nahiyi-ds-top-dashboard.nahiyi-theme-dark {
                --nh-bg-dash: rgba(30, 32, 35, 0.6);
                --nh-border-dash: rgba(255, 255, 255, 0.1);
                --nh-text-title: #f3f4f6;
                --nh-text-main: #e5e7eb;
                --nh-text-sub: #9ca3af;
                --nh-text-muted: #9ca3af;
                --nh-bg-controls: rgba(0,0,0,0.3);
                --nh-bg-card: rgba(40, 42, 45, 0.9);
                --nh-border-card: #374151;
                --nh-bg-btn-active: #1f2937;
                --nh-shadow-card: rgba(0, 0, 0, 0.2);
            }
            .nh-btn { border: none; background: transparent; padding: 6px 16px; border-radius: 6px; font-size: 13px; color: var(--nh-text-muted); cursor: pointer; transition: all 0.2s; }
            .nh-btn:hover { color: #3b82f6; }
            .nh-btn.active { background: var(--nh-bg-btn-active); color: #3b82f6; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
            .nh-badge { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
        `;
        document.head.appendChild(style);
    }

    function observeHostTheme() {
        if (themeCheckInterval) return;

        const checkTheme = () => {
            let currentlyDark = false;
            const body = document.body;
            if (body) {
                const bg = window.getComputedStyle(body).backgroundColor;
                const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (match) {
                    const r = parseInt(match[1], 10);
                    const g = parseInt(match[2], 10);
                    const b = parseInt(match[3], 10);
                    const brightness = Math.round(((r * 299) + (g * 587) + (b * 114)) / 1000);
                    currentlyDark = brightness < 128;
                }
            }
            if (!currentlyDark) {
                const htmlStr = document.documentElement.outerHTML;
                currentlyDark = htmlStr.includes('arco-theme="dark"') || htmlStr.includes('data-theme="dark"') || document.documentElement.classList.contains('dark');
            }
            if (isDarkMode !== currentlyDark) {
                isDarkMode = currentlyDark;
                const dashboard = document.getElementById('nahiyi-ds-top-dashboard');
                if (dashboard) {
                    isDarkMode ? dashboard.classList.add('nahiyi-theme-dark') : dashboard.classList.remove('nahiyi-theme-dark');
                    updateChartsTheme();
                }
            }
        };

        themeCheckInterval = setInterval(checkTheme, 300);
        checkTheme();
    }

    function updateChartsTheme() {
        const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
        const tickColor = isDarkMode ? '#9ca3af' : '#888';
        Object.values(chartInstances).forEach(chart => {
            if(chart.options.scales.x) chart.options.scales.x.ticks.color = tickColor;
            if(chart.options.scales.y) {
                chart.options.scales.y.grid.color = gridColor;
                chart.options.scales.y.ticks.color = tickColor;
            }
            if(chart.options.plugins.legend) chart.options.plugins.legend.labels.color = tickColor;
            chart.update();
        });
    }

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

    function formatCurrency(num) {
        if (isNaN(num) || num === 0) return '￥0.00';
        return '￥' + Number(num).toFixed(4);
    }

    function getDS(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function checkAndRender() {
        if (capturedAmountData && capturedCostData && capturedSummaryData) {
            injectThemeStyles();
            initDashboardLayout();
            renderCards();
            observeHostTheme();
        }
    }

    function initDashboardLayout() {
        const containerInfo = document.querySelector('.main-content') || document.querySelector('main');
        if (!containerInfo || document.getElementById('nahiyi-ds-top-dashboard')) return;

        let balanceStr = '0.00';
        let monthCostStr = '0.00';
        const sumBiz = capturedSummaryData?.data?.biz_data;
        if (sumBiz) {
            const normalBalance = Number(sumBiz.normal_wallets?.[0]?.balance || 0);
            const bonusBalance = Number(sumBiz.bonus_wallets?.[0]?.balance || 0);
            const totalBalance = normalBalance + bonusBalance;
            const currentMonthCost = Number(sumBiz.monthly_costs?.[0]?.amount || 0);
            
            balanceStr = totalBalance.toFixed(2);
            monthCostStr = currentMonthCost.toFixed(2);
        }

        const dashboard = document.createElement('div');
        dashboard.id = 'nahiyi-ds-top-dashboard';
        if (isDarkMode) dashboard.classList.add('nahiyi-theme-dark');
        dashboard.style.cssText = `margin: 20px 0; padding: 20px 24px; background: var(--nh-bg-dash); backdrop-filter: blur(12px); border: 1px solid var(--nh-border-dash); border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); display: flex; flex-direction: column; gap: 16px; z-index: 100; transition: all 0.3s;`;

        dashboard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--nh-border-dash); padding-bottom: 12px; transition: border-color 0.3s;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="font-size: 16px; font-weight: 600; color: var(--nh-text-title); transition: color 0.3s;">Token 用量与成本深度看板</div>
                    <div style="display: flex; gap: 8px;">
                        <span class="nh-badge" style="background: rgba(16,185,129,0.1); color: #10b981;">当前余额: ￥${balanceStr}</span>
                        <span class="nh-badge" style="background: rgba(239,68,68,0.1); color: #ef4444;">本月消费: ￥${monthCostStr}</span>
                    </div>
                </div>
                <div id="nahiyi-span-controls" style="display: flex; gap: 8px; background: var(--nh-bg-controls); padding: 4px; border-radius: 8px; transition: background 0.3s;">
                    <button data-span="today" class="nh-btn">最近3天</button>
                    <button data-span="thisWeek" class="nh-btn active">最近7天</button>
                    <button data-span="1month" class="nh-btn">本月</button>
                </div>
            </div>
            <div id="nahiyi-cards-container" style="display: flex; flex-direction: column; gap: 24px;"></div>
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
        const amountBiz = capturedAmountData?.data?.biz_data;
        const costBiz = capturedCostData?.data?.biz_data?.[0];
        if (!amountBiz || !amountBiz.days || !costBiz) return;

        const container = document.getElementById('nahiyi-cards-container');
        if (!container) return;
        container.innerHTML = ''; 

        let amountDaysArray = amountBiz.days;
        let filteredAmountDays = [];

        // 时间锚点：优先用真实今天，若数据滞后则取数据集最后一天
        const lastDataDateStr = amountDaysArray[amountDaysArray.length - 1].date;
        const baseDate = new Date(lastDataDateStr);
        
        const realToday = new Date();
        const realTodayStr = getDS(realToday);
        const isTodayInArray = amountDaysArray.some(d => d.date === realTodayStr);
        
        const safeBaseDate = isTodayInArray ? realToday : baseDate;

        if (currentSpan === 'today') {
            const start = new Date(safeBaseDate); start.setDate(safeBaseDate.getDate() - 2);
            filteredAmountDays = amountDaysArray.filter(d => d.date >= getDS(start) && d.date <= getDS(safeBaseDate));
            if (filteredAmountDays.length === 0 && amountDaysArray.length > 0) {
                 filteredAmountDays = [amountDaysArray[amountDaysArray.length - 1]]; 
            }
        } else if (currentSpan === 'thisWeek') {
            const start = new Date(safeBaseDate); start.setDate(safeBaseDate.getDate() - 6);
            filteredAmountDays = amountDaysArray.filter(d => d.date >= getDS(start) && d.date <= getDS(safeBaseDate));
        } else {
            filteredAmountDays = amountDaysArray; 
        }

        const modelsToRender = ['deepseek-v4-flash', 'deepseek-v4-pro'];

        modelsToRender.forEach(modelName => {
            let hitTotal = 0, missTotal = 0, outTotal = 0, costTotal = 0, requestTotal = 0;
            const labels = [], hitData = [], missData = [], outData = [], costGraphData = [];

            filteredAmountDays.forEach(dayInfo => {
                const dateStr = dayInfo.date;
                labels.push(dateStr.slice(5)); 
                const mUsage = dayInfo.data.find(m => m.model === modelName);
                
                let dHit = 0, dMiss = 0, dOut = 0, dReq = 0;
                if (mUsage) {
                    dHit = Number(mUsage.usage.find(u => u.type === 'PROMPT_CACHE_HIT_TOKEN')?.amount || 0);
                    dMiss = Number(mUsage.usage.find(u => u.type === 'PROMPT_CACHE_MISS_TOKEN')?.amount || 0);
                    dOut = Number(mUsage.usage.find(u => u.type === 'RESPONSE_TOKEN')?.amount || 0);
                    dReq = Number(mUsage.usage.find(u => u.type === 'REQUEST')?.amount || 0);
                }
                hitTotal += dHit; missTotal += dMiss; outTotal += dOut; requestTotal += dReq;
                hitData.push(dHit); missData.push(dMiss); outData.push(dOut);

                let dCost = 0;
                const costDay = costBiz.days.find(d => d.date === dateStr);
                const mCost = costDay?.data.find(m => m.model === modelName);
                if (mCost) mCost.usage.forEach(u => dCost += Number(u.amount || 0));
                costTotal += dCost;
                costGraphData.push(dCost);
            });

            const totalInput = hitTotal + missTotal;
            const hitRate = totalInput > 0 ? ((hitTotal / totalInput) * 100).toFixed(2) + '%' : '0.00%';

            const card = document.createElement('div');
            card.style.cssText = `width: 100%; box-sizing: border-box; background: var(--nh-bg-card); border-radius: 12px; padding: 24px; border: 1px solid var(--nh-border-card); display: flex; flex-direction: column; gap: 20px; box-shadow: 0 2px 12px var(--nh-shadow-card); transition: all 0.3s;`;
            const canvasId = `chart-${modelName}`;

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <h3 style="margin: 0; font-size: 18px; color: var(--nh-text-main); transition: color 0.3s;">${modelName}</h3>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <span class="nh-badge" style="background: rgba(16,185,129,0.1); color: #10b981;">综合命中率: ${hitRate}</span>
                            <span class="nh-badge" style="background: rgba(239,68,68,0.1); color: #ef4444;">阶段花费: ${formatCurrency(costTotal)}</span>
                            <span class="nh-badge" style="background: rgba(59,130,246,0.1); color: #3b82f6;">API请求数: ${requestTotal.toLocaleString()}</span>
                        </div>
                    </div>
                    <div style="font-size: 14px; color: var(--nh-text-sub); text-align: right; line-height: 1.8; transition: color 0.3s;">
                        <div>输入命中: <span style="font-weight:600; color:#3b82f6; margin-left: 8px;">${formatUnit(hitTotal)}</span></div>
                        <div>输入未命中: <span style="font-weight:600; color:#94a3b8; margin-left: 8px;">${formatUnit(missTotal)}</span></div>
                        <div>输出: <span style="font-weight:600; color:#f59e0b; margin-left: 8px;">${formatUnit(outTotal)}</span></div>
                        <div>成本: <span style="font-weight:600; color:#ef4444; margin-left: 8px;">${formatCurrency(costTotal)}</span></div>
                    </div>
                </div>
                <div style="position: relative; height: 240px; width: 100%;"><canvas id="${canvasId}"></canvas></div>
            `;
            container.appendChild(card);
            
            setTimeout(() => {
                const ctx = document.getElementById(canvasId).getContext('2d');
                if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

                const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
                const tickColor = isDarkMode ? '#9ca3af' : '#888';

                chartInstances[canvasId] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: '输入命中', data: hitData, yAxisID: 'y', borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.3, fill: true, borderWidth: 2, pointRadius: 3 },
                            { label: '输入未命中', data: missData, yAxisID: 'y', borderColor: '#94a3b8', tension: 0.3, fill: false, borderWidth: 2, pointRadius: 0 },
                            { label: '输出', data: outData, yAxisID: 'y', borderColor: '#f59e0b', tension: 0.3, fill: false, borderWidth: 2, pointRadius: 0 },
                            { label: '成本金额', data: costGraphData, yAxisID: 'y1', borderColor: '#ef4444', borderDash: [5, 5], tension: 0.3, fill: false, borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#ef4444' }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 16, font: { size: 12 }, padding: 20, color: tickColor } },
                            tooltip: {
                                padding: 12, bodySpacing: 6,
                                callbacks: {
                                    label: function(c) {
                                        let l = c.dataset.label + ': ';
                                        return l + (c.dataset.label === '成本金额' ? formatCurrency(c.parsed.y) : formatUnit(c.parsed.y));
                                    },
                                    afterBody: function(items) {
                                        let h = 0, m = 0;
                                        items.forEach(i => {
                                            if (i.dataset.label === '输入命中') h = i.parsed.y;
                                            if (i.dataset.label === '输入未命中') m = i.parsed.y;
                                        });
                                        return `\n► 当日缓存命中率: ${ (h+m)>0 ? ((h/(h+m))*100).toFixed(2)+'%' : '0.00%' }`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { grid: { display: false }, ticks: { font: { size: 11 }, color: tickColor } },
                            y: { type: 'linear', position: 'left', grid: { color: gridColor }, ticks: { font: { size: 11 }, color: tickColor, callback: v => formatUnit(v) } },
                            y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 11 }, color: '#ef4444', callback: v => '￥' + v.toFixed(2) } }
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
            if (url.includes('/api/v0/usage/amount')) { response.clone().json().then(data => { capturedAmountData = data; checkAndRender(); }); }
            else if (url.includes('/api/v0/usage/cost')) { response.clone().json().then(data => { capturedCostData = data; checkAndRender(); }); }
            else if (url.includes('/api/v0/users/get_user_summary')) { response.clone().json().then(data => { capturedSummaryData = data; checkAndRender(); }); }
        } catch (e) {}
        return response;
    };

    const originalXHR = window.XMLHttpRequest;
    function newXHR() {
        const xhr = new originalXHR();
        xhr.addEventListener('load', function() {
            if (xhr.responseURL) {
                if (xhr.responseURL.includes('/api/v0/usage/amount')) { try { capturedAmountData = JSON.parse(xhr.responseText); checkAndRender(); } catch(e){} }
                else if (xhr.responseURL.includes('/api/v0/usage/cost')) { try { capturedCostData = JSON.parse(xhr.responseText); checkAndRender(); } catch(e){} }
                else if (xhr.responseURL.includes('/api/v0/users/get_user_summary')) { try { capturedSummaryData = JSON.parse(xhr.responseText); checkAndRender(); } catch(e){} }
            }
        });
        return xhr;
    }
    window.XMLHttpRequest = newXHR;

})();