'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');

//  ---------------------------------------------------------------------------

module.exports = class independentreserve extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'independentreserve',
            'name': 'Independent Reserve',
            'countries': [ 'AU', 'NZ' ], // Australia, New Zealand
            'rateLimit': 1000,
            'has': {
                'CORS': false,
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/30521662-cf3f477c-9bcb-11e7-89bc-d1ac85012eda.jpg',
                'api': {
                    'public': 'https://api.independentreserve.com/Public',
                    'private': 'https://api.independentreserve.com/Private',
                },
                'www': 'https://www.independentreserve.com',
                'doc': 'https://www.independentreserve.com/API',
            },
            'api': {
                'public': {
                    'get': [
                        'GetValidPrimaryCurrencyCodes',
                        'GetValidSecondaryCurrencyCodes',
                        'GetValidLimitOrderTypes',
                        'GetValidMarketOrderTypes',
                        'GetValidOrderTypes',
                        'GetValidTransactionTypes',
                        'GetMarketSummary',
                        'GetOrderBook',
                        'GetTradeHistorySummary',
                        'GetRecentTrades',
                        'GetFxRates',
                    ],
                },
                'private': {
                    'post': [
                        'PlaceLimitOrder',
                        'PlaceMarketOrder',
                        'CancelOrder',
                        'GetOpenOrders',
                        'GetClosedOrders',
                        'GetClosedFilledOrders',
                        'GetOrderDetails',
                        'GetAccounts',
                        'GetTransactions',
                        'GetDigitalCurrencyDepositAddress',
                        'GetDigitalCurrencyDepositAddresses',
                        'SynchDigitalCurrencyDepositAddressWithBlockchain',
                        'WithdrawDigitalCurrency',
                        'RequestFiatWithdrawal',
                        'GetTrades',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'taker': 0.5 / 100,
                    'maker': 0.5 / 100,
                    'percentage': true,
                    'tierBased': false,
                },
            },
        });
    }

    async fetchMarkets () {
        let baseCurrencies = await this.publicGetGetValidPrimaryCurrencyCodes ();
        let quoteCurrencies = await this.publicGetGetValidSecondaryCurrencyCodes ();
        let result = [];
        for (let i = 0; i < baseCurrencies.length; i++) {
            let baseId = baseCurrencies[i];
            let baseIdUppercase = baseId.toUpperCase ();
            let base = this.commonCurrencyCode (baseIdUppercase);
            for (let j = 0; j < quoteCurrencies.length; j++) {
                let quoteId = quoteCurrencies[j];
                let quoteIdUppercase = quoteId.toUpperCase ();
                let quote = this.commonCurrencyCode (quoteIdUppercase);
                let id = baseId + '/' + quoteId;
                let symbol = base + '/' + quote;
                result.push ({
                    'id': id,
                    'symbol': symbol,
                    'base': base,
                    'quote': quote,
                    'baseId': baseId,
                    'quoteId': quoteId,
                    'info': id,
                });
            }
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let balances = await this.privatePostGetAccounts ();
        let result = { 'info': balances };
        for (let i = 0; i < balances.length; i++) {
            let balance = balances[i];
            let currencyCode = balance['CurrencyCode'];
            let uppercase = currencyCode.toUpperCase ();
            let currency = this.commonCurrencyCode (uppercase);
            let account = this.account ();
            account['free'] = balance['AvailableBalance'];
            account['total'] = balance['TotalBalance'];
            account['used'] = account['total'] - account['free'];
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetGetOrderBook (this.extend ({
            'primaryCurrencyCode': market['baseId'],
            'secondaryCurrencyCode': market['quoteId'],
        }, params));
        let timestamp = this.parse8601 (response['CreatedTimestampUtc']);
        return this.parseOrderBook (response, timestamp, 'BuyOrders', 'SellOrders', 'Price', 'Volume');
    }

    parseTicker (ticker, market = undefined) {
        let timestamp = this.parse8601 (ticker['CreatedTimestampUtc']);
        let symbol = undefined;
        if (market)
            symbol = market['symbol'];
        let last = ticker['LastPrice'];
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': ticker['DayHighestPrice'],
            'low': ticker['DayLowestPrice'],
            'bid': ticker['CurrentHighestBidPrice'],
            'bidVolume': undefined,
            'ask': ticker['CurrentLowestOfferPrice'],
            'askVolume': undefined,
            'vwap': undefined,
            'open': undefined,
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': undefined,
            'average': ticker['DayAvgPrice'],
            'baseVolume': ticker['DayVolumeXbtInSecondaryCurrrency'],
            'quoteVolume': undefined,
            'info': ticker,
        };
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetGetMarketSummary (this.extend ({
            'primaryCurrencyCode': market['baseId'],
            'secondaryCurrencyCode': market['quoteId'],
        }, params));
        return this.parseTicker (response, market);
    }

    parseOrder (order) {
        let orderType;
        if (/Market/.exec(order['Type'])) {
            orderType = 'market';
        } else if (/Limit/.exec(order['Type'])) {
            orderType = 'limit';
        }
        return {
            id: order['OrderGuid'],
            datetime: order['CreatedTimestampUtc'],
            type: orderType,
            timestamp: new Date(order['CreatedTimestampUtc']).getTime(),
            side: /Bid/.exec(order['OrderType']) ? 'buy' : 'sell',
            price: order['AvgPrice'],
            amount: order['VolumeOrdered'],
            filled: order['VolumeFilled'],
            fee: undefined,
            remaining: undefined,
            status: this.parseOrderStatus(order['Status']),
        };
    }

    parseOrderStatus (status) {
        let statuses = {
            'Open': 'open',
            'PartiallyFilled': 'open',
            'Filled': 'closed',
            'PartiallyFilledAndCancelled': 'canceled',
            'Cancelled': 'canceled',
            'PartiallyFilledAndExpired': 'canceled',
            'Expired': 'canceled'
        };
        return (status in statuses) ? statuses[status] : status.toLowerCase ();
    }

    async fetchOrder(id, symbol = undefined, params) {
        let request = {
            orderGuid: id
        };
        const response = await this.privatePostGetOrderDetails(this.extend(request, params));
        return this.parseOrder(response);
    }

    async fetchMyTrades(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const request = {
            pageIndex: params.pageIndex || 1,
            pageSize: 50
        };
        const response = await this.privatePostGetTrades (this.extend (request, params));
        return this.parseTrades(response['Data'], symbol && this.market (symbol), since, limit);
    }

    parseTrade (trade, market) {
        let timestamp = this.parse8601 (trade['TradeTimestampUtc']);
        return {
            'id': trade['TradeGuid'],
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': market['symbol'],
            'order': trade['OrderGuid'],
            'type': undefined,
            'side': /Bid/.exec(trade['OrderType']) ? 'buy' : 'sell',
            'price': trade['Price'],
            'amount': trade['VolumeTraded'],
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetGetRecentTrades (this.extend ({
            'primaryCurrencyCode': market['baseId'],
            'secondaryCurrencyCode': market['quoteId'],
            'numberOfRecentTradesToRetrieve': 50, // max = 50
        }, params));
        return this.parseTrades (response['Trades'], market, since, limit);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let capitalizedOrderType = this.capitalize (type);
        let method = 'privatePostPlace' + capitalizedOrderType + 'Order';
        let orderType = capitalizedOrderType;
        orderType += (side === 'sell') ? 'Offer' : 'Bid';
        let order = this.ordered ({
            'primaryCurrencyCode': market['baseId'],
            'secondaryCurrencyCode': market['quoteId'],
            'orderType': orderType,
        });
        if (type === 'limit')
            order['price'] = price;
        order['volume'] = amount;

        let response = await this[method] (this.extend (order, params));
        return {
            'info': response,
            'id': response['OrderGuid'],
        };
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        return await this.privatePostCancelOrder ({ 'orderGuid': id });
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'][api] + '/' + path;
        if (api === 'public') {
            if (Object.keys (params).length)
                url += '?' + this.urlencode (params);
        } else {
            this.checkRequiredCredentials ();
            let nonce = this.nonce ();
            let auth = [
                url,
                'apiKey=' + this.apiKey,
                'nonce=' + nonce.toString (),
            ];

            let keys = this.apiSpecificKeySort(Object.keys(params));

            const sortedParams = [];
            for (let i = 0; i < keys.length; i++) {
                let key = keys[i];
                sortedParams.push (key + '=' + params[key]);
            }

            let message = auth.concat(sortedParams).join(',');
            console.log(message);
            let signature = this.hmac (this.encode (message), this.encode (this.secret));
            let query = this.extend ({
                'apiKey': this.apiKey,
                'nonce': nonce,
                'signature': signature,
            }, this.apiSpecificKeySort(params));

            body = this.json (query);
            headers = { 'Content-Type': 'application/json' };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    apiSpecificKeySort(params, out = {}) {

        const keyOrder = [
            'amount',
            'withdrawalAddress',
            'comment',
            'depositAddress',
            'primaryCurrencyCode',
            'secondaryCurrencyCode',
            'withdrawalAmount',
            'withdrawalBankAccountName',
            'orderType',
            'price',
            'volume',
            'orderGuid',
            'accountGuid',
            'fromTimestampUtc',
            'toTimestampUtc',
            'txTypes',
            'pageIndex',
            'pageSize'
        ];

        if (params.constructor === Object) {
            for (const k of keyOrder) {
                if (params[k]) {
                    out[k] = params[k];
                }
            }
        } else if (params.constructor === Array) {
            out = [];
            for (const k of keyOrder) {
                const key = params.find(p => p === k);
                if (key) {
                    out.push(key);
                }
            }
        }

        return out;
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        // todo error handling
        return response;
    }
};
