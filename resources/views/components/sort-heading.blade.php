@props(['field', 'label', 'sorting', 'filters' => []])
@php
    $selected = $sorting['sort'] === $field;
    $next = $selected && $sorting['direction'] === 'asc' ? 'desc' : 'asc';
    $query = array_filter([...$filters, 'sort' => $field, 'direction' => $next], fn ($value) => $value !== null && $value !== '');
@endphp
<th scope="col" aria-sort="{{ $selected ? ($sorting['direction'] === 'asc' ? 'ascending' : 'descending') : 'none' }}">
    <a class="sort-heading {{ $selected ? 'is-sorted' : '' }}" data-sort-field="{{ $field }}" href="{{ route('devices.index', $query) }}" aria-label="{{ $label }}：按{{ $next === 'asc' ? '升序' : '降序' }}排列">
        {{ $label }}<span class="sort-indicator" aria-hidden="true">{{ $selected ? ($sorting['direction'] === 'asc' ? '↑' : '↓') : '⇅' }}</span>
    </a>
</th>
