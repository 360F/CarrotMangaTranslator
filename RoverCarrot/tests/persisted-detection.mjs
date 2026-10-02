import assert from 'node:assert/strict';

// Detection-only stored fields verified against the fork's strict schemas.
// Ordinary tests remain independent of the parent source and dependencies.
// Key sets are exact: the strict schemas reject any other key.
const pageKeys = ['id', 'name', 'imagePath', 'width', 'height', 'blocks', 'blockOrder', 'analysisStatus',
  'soundEffectReview', 'createdAt', 'updatedAt'];
const blockKeys = ['id', 'type', 'bbox', 'bboxSpace', 'sourceText', 'translatedText', 'textRole', 'confidence',
  'sourceDirection', 'renderDirection', 'rotationDeg', 'fontSizePx', 'lineHeight', 'textAlign', 'textColor',
  'outlineColor', 'backgroundColor', 'opacity', 'autoFitText', 'textDisplayMode', 'wordBreak', 'letterSpacing',
  'fontWidthScale', 'textOpacity', 'bold', 'italic', 'outlineWidthScale', 'workflowOrigin'];
// recognitionBboxes/ocrSubdivision are written only when the region carries them.
const originKeys = ['geometryKey', 'initialFontSize', 'initialFontStyle'];
const optionalOriginKeys = ['recognitionBboxes', 'ocrSubdivision'];
export function assertPersistedDetection(page) {
  assert.ok(!('pageWorkflow' in page));
  assert.deepEqual(Object.keys(page).sort(), [...pageKeys].sort());
  assert.deepEqual(page.blockOrder, page.blocks.map(block => block.id));
  assert.equal(page.analysisStatus, 'idle');
  for (const block of page.blocks) {
    assert.deepEqual(Object.keys(block).sort(), [...blockKeys].sort());
    assert.equal(block.type, 'nonsolid');
    assert.equal(block.bboxSpace, 'normalized_1000');
    const { x, y, w, h } = block.bbox;
    assert.ok(x >= 0 && x <= 999 && y >= 0 && y <= 999);
    assert.ok(w >= 1 && w <= 1000 - x && h >= 1 && h <= 1000 - y);
    assert.ok(block.confidence >= 0 && block.confidence <= 1);
    assert.deepEqual([block.sourceText, block.translatedText, block.sourceDirection, block.renderDirection],
      ['', '', 'horizontal', 'horizontal']);
    const defaults = { textRole: 'ordinary', rotationDeg: 0, lineHeight: 1.18, textAlign: 'center',
      textColor: '#111111', outlineColor: '#ffffff', backgroundColor: '#fef3c7', opacity: .7,
      autoFitText: true, textDisplayMode: 'translation-only', wordBreak: 'break-word', letterSpacing: 0,
      fontWidthScale: 1, textOpacity: 1, bold: false, italic: false, outlineWidthScale: 1 };
    for (const [key, value] of Object.entries(defaults)) assert.equal(block[key], value, key);
    const origin = block.workflowOrigin;
    assert.deepEqual(Object.keys(origin).sort(), [...originKeys, ...optionalOriginKeys.filter(key => key in origin)].sort());
    assert.ok(block.workflowOrigin.geometryKey);
    assert.equal(block.workflowOrigin.initialFontSize, block.fontSizePx);
    assert.deepEqual(block.workflowOrigin.initialFontStyle, {
      bold: false, italic: false, textColor: block.textColor, outlineColor: block.outlineColor });
  }
  const review = page.soundEffectReview;
  assert.deepEqual(Object.keys(review).sort(), ['contractVersion', 'producer', 'regions', 'regionOverrides', 'manualRegions', 'resolvedRegions'].sort());
  assert.equal(review.contractVersion, 3);
  assert.equal(review.producer, 'hayai-regions-v1');
  assert.deepEqual([review.regionOverrides, review.manualRegions, review.resolvedRegions], [[], [], []]);
  for (const region of review.regions) {
    assert.deepEqual(Object.keys(region).sort(), ['id', 'bbox', 'detectorConfidence', 'sourceDetectionIds'].sort());
    assert.ok(region.sourceDetectionIds.length);
  }
}
