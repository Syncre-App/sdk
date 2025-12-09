class HttpClient {
	constructor({ baseUrl, tokenProvider }) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.tokenProvider = tokenProvider;
	}

	async request(path, options = {}) {
		if (typeof fetch !== 'function') {
			throw new Error('Global fetch is not available. Node.js 18+ is required.');
		}

		const url = this.buildUrl(path);
		const headers = {
			'Content-Type': 'application/json',
			...(options.headers || {}),
		};

		const token = this.tokenProvider?.();
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}

		const response = await fetch(url, {
			method: options.method || 'GET',
			headers,
			body: options.body,
		});

		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const error = new Error(data?.message || `Request failed with status ${response.status}`);
			error.status = response.status;
			error.response = data;
			throw error;
		}

		return data;
	}

	buildUrl(path) {
		return path.startsWith('/') ? `${this.baseUrl}${path}` : `${this.baseUrl}/${path}`;
	}
}

module.exports = HttpClient;
