// ==UserScript==
// @name         DeepSeek Usage Dashboard Enhancer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  增强 DeepSeek Token 用量显示：添加直观的中文单位、缓存命中率，并提取至全局面板，免除悬浮查看且不直观的烦恼。
// @author       Nahiyi
// @match        https://platform.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepseek.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 中文数字单位格式化函数
    function formatNumberWithUnit(numStr) {
        const num = Number(numStr);
        if (isNaN(num) || num === 0) return '0';
        
        if (num >= 10000000) return (num / 10000000).toFixed(2) + ' 千万';
        if (num >= 1000000) return (num / 1000000).toFixed(2) + ' 百万';
        if (num >= 100000) return (num / 100000).toFixed(2) + ' 十万';
        if (num >= 10000) return (num / 10000).toFixed(2) + ' 万';
        return num.toString();
    }

    // 渲染极简风数据面板
    function renderStatsPanel(data) {
        // 避免重复渲染
        if (document.getElementById('nahiyi-ds-enhancer-panel')) {
            document.getElementById('nahiyi-ds-enhancer-panel').remove();
        }

        const totalData = data?.data?.biz_data?.total;
        if (!totalData || !Array.isArray(totalData)) return;

        // 构建面板容器 (毛玻璃极简UI)
        const panel = document.createElement('div');
        panel.id = 'nahiyi-ds-enhancer-panel';
        panel.style.cssText = `
            margin: 20px 0;
            padding: 20px;
            background: rgba(255, 255, 255, 0.6);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.05);
            display: flex;
            gap: 24px;
            flex-wrap: wrap;
            z-index: 999;
        `;

        totalData.forEach(modelData => {
            const modelName = modelData.model;
            // 过滤出我们需要关注的模型
            if (!modelName.includes('pro') && !modelName.includes('flash')) return;

            let cacheHit = 0;
            let cacheMiss = 0;
            let outputToken = 0;

            modelData.usage.forEach(item => {
                if (item.type === 'PROMPT_CACHE_HIT_TOKEN') cacheHit = Number(item.amount);
                if (item.type === 'PROMPT_CACHE_MISS_TOKEN') cacheMiss = Number(item.amount);
                if (item.type === 'RESPONSE_TOKEN') outputToken = Number(item.amount);
            });

            const totalInput = cacheHit + cacheMiss;
            const hitRate = totalInput > 0 ? ((cacheHit / totalInput) * 100).toFixed(2) + '%' : '0.00%';

            // 生成单个模型的卡片
            const card = document.createElement('div');
            card.style.cssText = `
                flex: 1;
                min-width: 280px;
                padding: 16px;
                background: rgba(255, 255, 255, 0.8);
                border-radius: 8px;
                border: 1px solid #eaeaea;
            `;

            card.innerHTML = `
                <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #1a1a1a; display: flex; justify-content: space-between;">
                    <span>${modelName} 核心用量</span>
                    <span style="color: #4CAF50; font-weight: 600;">命中率: ${hitRate}</span>
                </h3>
                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: #555;">
                    <div style="display: flex; justify-content: space-between;">
                        <span>📥 输入缓存命中:</span>
                        <span style="font-weight: 500; color: #1a1a1a;">${formatNumberWithUnit(cacheHit)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>📤 输入未命中:</span>
                        <span style="font-weight: 500; color: #1a1a1a;">${formatNumberWithUnit(cacheMiss)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>🚀 输出 Token:</span>
                        <span style="font-weight: 500; color: #1a1a1a;">${formatNumberWithUnit(outputToken)}</span>
                    </div>
                </div>
            `;
            panel.appendChild(card);
        });

        // 寻找合适的注入点 (图表容器的上方)
        const observer = setInterval(() => {
            // 根据截图，寻找大致的图表容器父节点，这里以常用的 main 或页面包裹节点为例
            // 实际使用时，如果注入位置不理想，可调整 querySelector 的目标
            const container = document.querySelector('.main-content') || document.querySelector('main') || document.body;
            if (container) {
                // 插入到容器最前面
                container.insertBefore(panel, container.firstChild);
                clearInterval(observer);
            }
        }, 500);
    }

    // 拦截 Fetch API
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = args[0] instanceof Request ? args[0].url : args[0];
            if (url && url.includes('/api/v0/usage/amount')) {
                // 克隆响应以免影响原页面的读取
                const clone = response.clone();
                clone.json().then(data => {
                    renderStatsPanel(data);
                }).catch(err => console.error("解析 JSON 失败", err));
            }
        } catch (e) {
            console.error("拦截器异常", e);
        }
        return response;
    };

    // 拦截 XMLHttpRequest (兼容处理)
    const originalXHR = window.XMLHttpRequest;
    function newXHR() {
        const xhr = new originalXHR();
        xhr.addEventListener('load', function() {
            if (xhr.responseURL && xhr.responseURL.includes('/api/v0/usage/amount')) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    renderStatsPanel(data);
                } catch (e) {
                    console.error("XHR JSON解析失败", e);
                }
            }
        });
        return xhr;
    }
    window.XMLHttpRequest = newXHR;

})();