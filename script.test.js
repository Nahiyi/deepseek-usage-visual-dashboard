const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.eventListeners = {};
        this.attributes = {};
        this.className = '';
        this.textContent = '';
        this.innerHTML = '';
        this._id = '';
    }

    set id(value) {
        this._id = value;
        if (value) {
            this.ownerDocument.elementsById.set(value, this);
        }
    }

    get id() {
        return this._id;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) {
            this.ownerDocument.elementsById.set(child.id, child);
        }
        return child;
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        if (this.id) {
            this.ownerDocument.elementsById.delete(this.id);
        }
        this.parentNode = null;
    }

    addEventListener(type, handler) {
        this.eventListeners[type] = handler;
    }
}

class FakeDocument {
    constructor() {
        this.elementsById = new Map();
        this.body = new FakeElement('body', this);
        this.head = new FakeElement('head', this);
        this.eventListeners = {};
        this.documentElement = {
            outerHTML: '<html></html>',
            classList: { contains: () => false }
        };
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }

    getElementById(id) {
        return this.elementsById.get(id) || null;
    }

    querySelector() {
        return null;
    }

    querySelectorAll() {
        return [];
    }

    addEventListener(type, handler) {
        this.eventListeners[type] = handler;
    }

    removeEventListener(type) {
        delete this.eventListeners[type];
    }
}

function loadHooks() {
    const sourcePath = path.join(__dirname, 'script.js');
    const originalSource = fs.readFileSync(sourcePath, 'utf8');
    const instrumentedSource = originalSource.replace(
        /\}\)\(\);\s*$/,
        'window.__testHooks = { addPersonalPriceButton, showPersonalPriceModal, calculatePersonalPriceRows: typeof calculatePersonalPriceRows !== "undefined" ? calculatePersonalPriceRows : undefined, buildPersonalPriceDebugInfo: typeof buildPersonalPriceDebugInfo !== "undefined" ? buildPersonalPriceDebugInfo : undefined, formatTokenInputDisplayValue: typeof formatTokenInputDisplayValue !== "undefined" ? formatTokenInputDisplayValue : undefined, parseTokenInputValue: typeof parseTokenInputValue !== "undefined" ? parseTokenInputValue : undefined };})();'
    );

    const document = new FakeDocument();
    const dashboard = document.createElement('div');
    dashboard.id = 'nahiyi-ds-top-dashboard';
    const controls = document.createElement('div');
    controls.id = 'nahiyi-span-controls';
    dashboard.appendChild(controls);
    document.body.appendChild(dashboard);

    function XMLHttpRequestStub() {}
    XMLHttpRequestStub.prototype.addEventListener = () => {};

    const context = {
        window: {
            document,
            fetch: async () => ({ clone: () => ({ json: async () => ({}) }) }),
            XMLHttpRequest: XMLHttpRequestStub,
            getComputedStyle: () => ({ backgroundColor: 'rgb(255, 255, 255)' })
        },
        document,
        Chart: function ChartStub() {},
        Request: function RequestStub(url) { this.url = url; },
        setTimeout: () => 0,
        setInterval: () => 0,
        clearInterval: () => {},
        console
    };

    vm.createContext(context);
    vm.runInContext(instrumentedSource, context);
    return { hooks: context.window.__testHooks, document };
}

function testPersonalPriceButtonUsesCompactSizingOverrides() {
    const { hooks, document } = loadHooks();
    hooks.addPersonalPriceButton();

    const button = document.getElementById('personal-price-btn');
    assert.ok(button, 'expected personal price button to be rendered');
    assert.equal(button.style.padding, '4px 10px');
    assert.equal(button.style.fontSize, '12px');
}

function testPersonalPriceModalRendersInsideOverlay() {
    const { hooks, document } = loadHooks();
    hooks.showPersonalPriceModal();

    const overlay = document.getElementById('personal-price-modal-overlay');
    assert.ok(overlay, 'expected a dedicated full-screen overlay');
    assert.match(overlay.style.cssText, /position:\s*fixed/i);
    assert.match(overlay.style.cssText, /inset:\s*0/i);

    const modal = document.getElementById('personal-price-modal');
    assert.ok(modal, 'expected modal panel inside overlay');
    assert.equal(modal.parentNode, overlay);
    assert.doesNotMatch(modal.style.cssText, /var\(--nh-bg-card\)/);
    assert.match(modal.style.cssText, /background:\s*rgba\(/i);
}

function testPersonalPriceRowsUsePerMillionTokenPricing() {
    const { hooks } = loadHooks();
    assert.equal(typeof hooks.calculatePersonalPriceRows, 'function', 'expected calculatePersonalPriceRows helper');

    const rows = hooks.calculatePersonalPriceRows({
        totalInput: 1000000,
        hitRates: [0.5],
        outputRatio: 0.2
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].models.length, 2);
    assert.equal(rows[0].models[0].modelName, 'v4-flash');
    assert.equal(rows[0].models[0].inputCost, 0.51);
    assert.equal(rows[0].models[0].outputCost, 0.4);
    assert.equal(rows[0].models[0].totalCost, 0.91);
    assert.equal(rows[0].models[1].modelName, 'v4-pro');
    assert.equal(rows[0].models[1].inputCost, 1.5125);
    assert.equal(rows[0].models[1].outputCost, 1.2);
    assert.equal(rows[0].models[1].totalCost, 2.7125);
}

function testPersonalPriceDebugInfoSummarizesReferenceStats() {
    const { hooks } = loadHooks();
    assert.equal(typeof hooks.buildPersonalPriceDebugInfo, 'function', 'expected buildPersonalPriceDebugInfo helper');

    const debugInfo = hooks.buildPersonalPriceDebugInfo({
        spanKey: 'thisWeek',
        totalInput: 2000000,
        hitRates: [0.9, 0.95, 0.99],
        stats: {
            dayCount: 7,
            dateRangeStart: '2026-05-09',
            dateRangeEnd: '2026-05-15',
            sumHit: 1800000,
            sumMiss: 200000,
            sumInput: 2000000,
            sumOutput: 120000,
            outputRatio: 0.06
        }
    });

    assert.equal(debugInfo.referenceSpanLabel, '最近7天');
    assert.equal(debugInfo.referenceDayCount, 7);
    assert.equal(debugInfo.referenceDateRange.start, '2026-05-09');
    assert.equal(debugInfo.referenceDateRange.end, '2026-05-15');
    assert.equal(debugInfo.sampleInputTokens, 2000000);
    assert.equal(debugInfo.sampleOutputTokens, 120000);
    assert.equal(debugInfo.outputInputRatio, 0.06);
    assert.deepEqual(debugInfo.requestedHitRatesPercent, [90, 95, 99]);
}

function testTokenInputFormattingHelpersSupportCommaSeparatedEditing() {
    const { hooks } = loadHooks();
    assert.equal(typeof hooks.formatTokenInputDisplayValue, 'function', 'expected formatTokenInputDisplayValue helper');
    assert.equal(typeof hooks.parseTokenInputValue, 'function', 'expected parseTokenInputValue helper');

    assert.equal(hooks.formatTokenInputDisplayValue('2000000'), '2,000,000');
    assert.equal(hooks.formatTokenInputDisplayValue('2,00a0,000 tokens'), '2,000,000');
    assert.equal(hooks.parseTokenInputValue('2,000,000'), 2000000);
    assert.equal(hooks.parseTokenInputValue(''), 0);
}

const tests = [
    ['personal price button uses compact sizing overrides', testPersonalPriceButtonUsesCompactSizingOverrides],
    ['personal price modal renders inside a full-screen overlay with opaque panel styles', testPersonalPriceModalRendersInsideOverlay],
    ['personal price rows use per-million token pricing', testPersonalPriceRowsUsePerMillionTokenPricing],
    ['personal price debug info summarizes reference stats', testPersonalPriceDebugInfoSummarizesReferenceStats],
    ['token input formatting helpers support comma separated editing', testTokenInputFormattingHelpersSupportCommaSeparatedEditing]
];

let failed = 0;
tests.forEach(([name, fn]) => {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error.stack);
    }
});

if (failed > 0) {
    process.exitCode = 1;
}
