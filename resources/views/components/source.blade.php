@props(['value'])
<span class="badge {{ $value === 'sample' ? 'bg-purple-lt' : 'bg-azure-lt' }}">{{ $value === 'sample' ? '示例数据' : ($value === 'api' ? '设备 API' : '手动导入') }}</span>
