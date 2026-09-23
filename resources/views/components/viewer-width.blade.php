@props(['panel', 'label'])
<div class="viewer-width" role="group" aria-label="{{ $label }}宽度">
    <button type="button" class="btn" data-panel-resize="{{ $panel }}" data-step="-20" aria-label="缩小{{ $label }}">−</button>
    <span>屏幕 <output data-panel-width="{{ $panel }}" aria-live="polite">300</output>px</span>
    <button type="button" class="btn" data-panel-resize="{{ $panel }}" data-step="20" aria-label="放大{{ $label }}">＋</button>
</div>
