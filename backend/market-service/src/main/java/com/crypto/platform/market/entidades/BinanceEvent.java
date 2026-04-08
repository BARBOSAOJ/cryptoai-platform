package com.crypto.platform.market.entidades;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class BinanceEvent {
    public BinanceTicker data;
}