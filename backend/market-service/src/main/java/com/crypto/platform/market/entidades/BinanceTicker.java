package com.crypto.platform.market.entidades;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class BinanceTicker {

    @JsonProperty("s")
    public String symbol;

    @JsonProperty("p")
    public String price;

    public BinanceTicker() {}

    @Override
    public String toString() {
        return symbol + ": " + price;
    }
}