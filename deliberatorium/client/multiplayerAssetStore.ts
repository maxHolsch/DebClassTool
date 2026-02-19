import { TLAssetStore, uniqueId } from 'tldraw'

export function createMultiplayerAssetStore(): TLAssetStore {
	return {
		async upload(_asset, file) {
			const id = uniqueId()
			const objectName = `${id}-${file.name}`.replace(/[^a-zA-Z0-9.]/g, '-')
			const url = `/assets/${objectName}`

			const response = await fetch(url, {
				method: 'POST',
				body: file,
			})

			if (!response.ok) {
				throw new Error(`Failed to upload asset: ${response.statusText}`)
			}

			return { src: url }
		},

		resolve(asset) {
			return asset.props.src
		},
	}
}
