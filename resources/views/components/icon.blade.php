@props(['name', 'size' => 20])
<img src="{{ asset('vendor/icons/'.$name.'.svg') }}" width="{{ $size }}" height="{{ $size }}" alt="" aria-hidden="true" {{ $attributes->class(['lab-icon']) }}>
